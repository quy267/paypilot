import { createWorkersAI } from "workers-ai-provider";
import { callable, routeAgentRequest } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { convertToModelMessages, pruneMessages, streamText } from "ai";
import {
  buildEvidence,
  decideResolution,
  getTransaction,
  listInbox,
  listResolutions
} from "./services/triage";
import {
  SYSTEM_PROMPT,
  TRIAGE_MODEL_ID,
  TRIAGE_STOP,
  buildTriageTools
} from "./agent/triage-core";

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
      model: workersai(TRIAGE_MODEL_ID, {
        sessionAffinity: this.sessionAffinity
      }),
      system: SYSTEM_PROMPT,
      // Prune old tool calls to save tokens on long conversations
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages"
      }),
      tools: {
        // MCP tools from any connected servers (none by default), plus the shared
        // PayPilot triage tools (listInbox/getTransaction/proposeResolution) on D1.
        ...mcpTools,
        ...buildTriageTools(DB)
      },
      stopWhen: TRIAGE_STOP,
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
