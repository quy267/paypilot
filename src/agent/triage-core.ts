// PayPilot triage agent core — the system prompt, model id, and tool set that drive
// the LLM. Defined once here and shared by BOTH:
//   - the live agent (src/server.ts) over a real Worker `env.AI` binding + `env.DB`, and
//   - the offline eval harness (eval/run-eval.ts) over a REST model + an in-memory D1.
// Keeping one definition means the eval measures exactly what production runs.

import { stepCountIs, tool } from "ai";
import { z } from "zod";
import {
  buildEvidence,
  formatAmount,
  getTransaction,
  listInbox,
  listResolutions,
  proposeResolution
} from "../services/triage";

/** Workers AI model id used for triage (Kimi, free tier). */
export const TRIAGE_MODEL_ID = "@cf/moonshotai/kimi-k2.6";

/** Stop one triage turn after at most this many reasoning/tool steps. */
export const TRIAGE_STOP = stepCountIs(8);

export const SYSTEM_PROMPT = `You are PayPilot, an AI assistant for a payment operations team. You triage failed, flagged, or stuck payment transactions.

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

/**
 * The triage tool set — listInbox / getTransaction / proposeResolution — bound to a
 * given D1 database. Both the live agent and the eval harness spread this into
 * `streamText`/`generateText` so the model drives identical tools against whichever
 * database (real remote D1 or an in-memory eval D1) is passed in.
 */
export function buildTriageTools(DB: D1Database) {
  return {
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
        diagnosis: z.string().describe("Plain-language root-cause explanation"),
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
  };
}
