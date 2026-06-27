import { createWorkersAI } from "workers-ai-provider";
import { callable, routeAgentRequest } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText,
  tool
} from "ai";
import { z } from "zod";
import {
  buildEvidence,
  decideResolution,
  formatAmount,
  getTransaction,
  listInbox,
  listResolutions,
  proposeResolution
} from "./services/triage";

const SYSTEM_PROMPT = `You are PayPilot, an AI assistant for a payment operations team. You triage failed, flagged, or stuck payment transactions.

When the user asks you to handle/triage an exception, you MUST complete this whole sequence in one turn. Do NOT stop after the first tool call, and do NOT ask the user what to do next:
STEP 1 — Call listInbox to see open transactions (already prioritized: FLAGGED first, then largest amount, then newest).
STEP 2 — Choose the most urgent transaction (or the one the user names) and call getTransaction with its id to read full details + evidence.
STEP 3 — Decide exactly ONE action:
   - RETRY — transient failures (e.g. TIMEOUT, GATEWAY_ERROR) where money was not captured.
   - ESCALATE — needs a human/specialist (suspected fraud, unclear cause, unusually large amounts).
   - REFUND — ONLY for FLAGGED transactions where money was captured (e.g. a duplicate charge). Never REFUND a FAILED transaction.
STEP 4 — Call proposeResolution with {transaction_id, action, diagnosis, confidence (0..1), evidence}. This records a PENDING proposal for a human to approve. You MUST call this tool — proposing in plain text only does not count.
STEP 5 — After proposeResolution succeeds, write a SHORT final summary to the user: the transaction id, the action, your confidence, and one line of reasoning citing the evidence (failure_code, gateway_ref, amount, etc.).

Rules:
- ALWAYS reply to the operator in clear, plain Vietnamese (the payment ops team is Vietnamese). Keep transaction ids, status/failure codes, gateway refs and amounts unchanged. Your tool calls and tool arguments stay in their original form.
- Amounts are in minor units (đồng) — integers.
- Exactly ONE action per transaction. Never invent transactions or fields.
- A human operator approves or rejects your proposal separately. If a proposal is rejected, do NOT silently change the transaction or invent a new state — wait for instructions.`;

export class TriageAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;

  onStart() {
    // Configure OAuth popup behavior for MCP servers that require authentication
    this.mcp.configureOAuthCallback({
      customHandler: (result) => {
        if (result.authSuccess) {
          return new Response("<script>window.close();</script>", {
            headers: { "content-type": "text/html" },
            status: 200
          });
        }
        return new Response(
          `Authentication Failed: ${result.authError || "Unknown error"}`,
          { headers: { "content-type": "text/plain" }, status: 400 }
        );
      }
    });
  }

  @callable()
  async addServer(name: string, url: string) {
    return await this.addMcpServer(name, url);
  }

  @callable()
  async removeServer(serverId: string) {
    await this.removeMcpServer(serverId);
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const mcpTools = this.mcp.getAITools();
    const workersai = createWorkersAI({ binding: this.env.AI });
    const { DB } = this.env;

    const result = streamText({
      model: workersai("@cf/moonshotai/kimi-k2.6", {
        sessionAffinity: this.sessionAffinity
      }),
      system: SYSTEM_PROMPT,
      // Prune old tool calls to save tokens on long conversations
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages"
      }),
      tools: {
        // MCP tools from any connected servers (none by default)
        ...mcpTools,

        // Read: the inbox of open transactions, already prioritized.
        listInbox: tool({
          description:
            "List open payment transactions that need attention (FAILED, FLAGGED, or PENDING), already prioritized.",
          inputSchema: z.object({
            limit: z
              .number()
              .int()
              .min(1)
              .max(50)
              .optional()
              .describe("Max rows to return (default 20)")
          }),
          execute: async ({ limit }) => {
            const rows = await listInbox(DB, limit ?? 20);
            return {
              count: rows.length,
              transactions: rows.map((t) => ({
                id: t.id,
                status: t.status,
                method: t.method,
                amount: formatAmount(t.amount_minor, t.currency),
                failure_code: t.failure_code,
                failure_reason: t.failure_reason,
                merchant_id: t.merchant_id
              }))
            };
          }
        }),

        // Read: one transaction's full details + evidence + prior resolutions.
        getTransaction: tool({
          description:
            "Get full details, evidence, and prior resolutions for one transaction by id (e.g. 'txn_0006').",
          inputSchema: z.object({
            id: z.string().describe("Transaction id, e.g. txn_0006")
          }),
          execute: async ({ id }) => {
            const txn = await getTransaction(DB, id);
            if (!txn) return { error: `Unknown transaction: ${id}` };
            return {
              transaction: {
                ...txn,
                amount: formatAmount(txn.amount_minor, txn.currency)
              },
              evidence: buildEvidence(txn),
              resolutions: await listResolutions(DB, id)
            };
          }
        }),

        // Write: record a PENDING proposal for a human to approve.
        proposeResolution: tool({
          description:
            "Record a PENDING proposed resolution for a transaction, for a human operator to approve. REFUND is only valid for FLAGGED transactions.",
          inputSchema: z.object({
            transaction_id: z.string(),
            action: z.enum(["RETRY", "ESCALATE", "REFUND"]),
            diagnosis: z
              .string()
              .describe("Plain-language root-cause explanation"),
            confidence: z.number().min(0).max(1),
            evidence: z
              .record(z.string(), z.unknown())
              .optional()
              .describe("Fields/values that justify the diagnosis")
          }),
          execute: async ({
            transaction_id,
            action,
            diagnosis,
            confidence,
            evidence
          }) =>
            await proposeResolution(DB, {
              transaction_id,
              action,
              diagnosis,
              confidence,
              evidence
            })
        })
      },
      stopWhen: stepCountIs(8),
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse();
  }
}

/**
 * PayPilot JSON API for the inbox UI. These routes are how the React app reads
 * data and records operator decisions — separate from the agent's tools so the
 * audit trail never depends on an approval-gated tool's execute path.
 * `/api/*` is listed in wrangler.jsonc `run_worker_first` so it reaches here.
 */
async function handleApi(request: Request, env: Env): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json" }
    });

  if (pathname === "/api/inbox" && request.method === "GET") {
    return json({ transactions: await listInbox(env.DB, 50) });
  }

  const txnMatch = pathname.match(/^\/api\/transactions\/([^/]+)$/);
  if (txnMatch && request.method === "GET") {
    const id = decodeURIComponent(txnMatch[1]);
    const txn = await getTransaction(env.DB, id);
    if (!txn) return json({ error: "not found" }, 404);
    return json({
      transaction: txn,
      evidence: buildEvidence(txn),
      resolutions: await listResolutions(env.DB, id)
    });
  }

  const decideMatch = pathname.match(/^\/api\/resolutions\/([^/]+)\/decide$/);
  if (decideMatch && request.method === "POST") {
    const id = decodeURIComponent(decideMatch[1]);
    const body = (await request.json().catch(() => ({}))) as {
      decision?: string;
      operator_id?: string;
      note?: string;
    };
    if (body.decision !== "APPROVED" && body.decision !== "REJECTED") {
      return json({ error: "decision must be APPROVED or REJECTED" }, 400);
    }
    const res = await decideResolution(env.DB, {
      resolution_id: id,
      decision: body.decision,
      operator_id: body.operator_id ?? "operator",
      note: body.note
    });
    return json(res, res.ok ? 200 : 400);
  }

  return null; // not an API route — fall through
}

export default {
  async fetch(request: Request, env: Env) {
    const apiResponse = await handleApi(request, env);
    if (apiResponse) return apiResponse;
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
