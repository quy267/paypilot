// PayPilot domain service — the single source of truth for all transaction/resolution
// data operations over D1. Called by BOTH the agent's tools (LLM side) and the Worker
// JSON API routes (UI side), so business rules live here exactly once.
//
// `D1Database` is an ambient global from @cloudflare/workers-types (see env.d.ts).

export interface TransactionRow {
  id: string;
  merchant_id: string;
  gateway_ref: string | null;
  amount_minor: number;
  currency: string;
  method: "QR" | "CARD" | "SOFTPOS";
  status: "SUCCESS" | "FAILED" | "FLAGGED" | "PENDING";
  failure_code: string | null;
  failure_reason: string | null;
  created_at: number;
}

export interface ResolutionRow {
  id: string;
  transaction_id: string;
  ai_diagnosis: string | null;
  proposed_action: "RETRY" | "ESCALATE" | "REFUND" | null;
  confidence: number | null;
  evidence: string | null;
  operator_id: string | null;
  operator_decision: "APPROVED" | "REJECTED" | "PENDING";
  operator_note: string | null;
  created_at: number;
  decided_at: number | null;
}

export type ProposedAction = "RETRY" | "ESCALATE" | "REFUND";
export type Decision = "APPROVED" | "REJECTED";

/** Format a minor-unit integer amount for display, e.g. (85000, "VND") -> "85.000 VND". */
export function formatAmount(minor: number, currency: string): string {
  const grouped = Math.round(minor)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${grouped} ${currency}`;
}

/** Current time as epoch seconds (the unit `created_at`/`decided_at` use). */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Open items for the inbox, prioritized: FLAGGED first (review risk), then FAILED,
 * then PENDING; within a status, largest amount first, then newest.
 * Uses idx_transactions_inbox(status, created_at).
 */
export async function listInbox(
  db: D1Database,
  limit = 50
): Promise<TransactionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM transactions
       WHERE status IN ('FAILED','FLAGGED','PENDING')
       ORDER BY CASE status WHEN 'FLAGGED' THEN 0 WHEN 'FAILED' THEN 1 ELSE 2 END,
                amount_minor DESC,
                created_at DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<TransactionRow>();
  return results ?? [];
}

export async function getTransaction(
  db: D1Database,
  id: string
): Promise<TransactionRow | null> {
  return await db
    .prepare("SELECT * FROM transactions WHERE id = ? LIMIT 1")
    .bind(id)
    .first<TransactionRow>();
}

export async function listResolutions(
  db: D1Database,
  transactionId: string
): Promise<ResolutionRow[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM resolutions WHERE transaction_id = ? ORDER BY created_at DESC"
    )
    .bind(transactionId)
    .all<ResolutionRow>();
  return results ?? [];
}

/** The fields that justify a diagnosis — what the AI must point at as evidence. */
export function buildEvidence(txn: TransactionRow): Record<string, unknown> {
  return {
    transaction_id: txn.id,
    status: txn.status,
    method: txn.method,
    amount_minor: txn.amount_minor,
    currency: txn.currency,
    failure_code: txn.failure_code,
    failure_reason: txn.failure_reason,
    gateway_ref: txn.gateway_ref,
    merchant_id: txn.merchant_id
  };
}

export interface ProposeInput {
  transaction_id: string;
  action: ProposedAction;
  diagnosis: string;
  confidence: number;
  evidence?: unknown;
}

export type ServiceResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

/**
 * Record a PENDING proposed resolution. Enforces the rules the DB schema can't:
 *  - REFUND is only valid for FLAGGED transactions (money captured), never FAILED.
 *  - confidence must be in [0,1].
 *  - at most ONE active (PENDING) resolution per transaction (no duplicate proposals).
 */
export async function proposeResolution(
  db: D1Database,
  input: ProposeInput
): Promise<ServiceResult<{ resolution_id: string }>> {
  const txn = await getTransaction(db, input.transaction_id);
  if (!txn) {
    return { ok: false, error: `Unknown transaction: ${input.transaction_id}` };
  }
  if (input.action === "REFUND" && txn.status !== "FLAGGED") {
    return {
      ok: false,
      error:
        "REFUND is only allowed for FLAGGED transactions, not " + txn.status
    };
  }
  if (input.confidence < 0 || input.confidence > 1) {
    return { ok: false, error: "confidence must be between 0 and 1" };
  }
  const existing = await db
    .prepare(
      "SELECT id FROM resolutions WHERE transaction_id = ? AND operator_decision = 'PENDING' LIMIT 1"
    )
    .bind(input.transaction_id)
    .first<{ id: string }>();
  if (existing) {
    return {
      ok: false,
      error: `A pending resolution already exists for ${input.transaction_id} (${existing.id})`
    };
  }

  const id = `res_${crypto.randomUUID().slice(0, 12)}`;
  const evidenceJson =
    typeof input.evidence === "string"
      ? input.evidence
      : JSON.stringify(input.evidence ?? buildEvidence(txn));

  await db
    .prepare(
      `INSERT INTO resolutions
         (id, transaction_id, ai_diagnosis, proposed_action, confidence, evidence, operator_decision, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?)`
    )
    .bind(
      id,
      input.transaction_id,
      input.diagnosis,
      input.action,
      input.confidence,
      evidenceJson,
      nowSeconds()
    )
    .run();

  return { ok: true, resolution_id: id };
}

export interface DecideInput {
  resolution_id: string;
  decision: Decision;
  operator_id: string;
  note?: string;
}

/**
 * Operator approves/rejects a proposal. Idempotent state machine:
 * PENDING -> APPROVED/REJECTED is a one-way move; a resolution that is already
 * decided is returned unchanged (calling /decide twice is safe).
 */
export async function decideResolution(
  db: D1Database,
  input: DecideInput
): Promise<ServiceResult<{ resolution: ResolutionRow }>> {
  const res = await db
    .prepare("SELECT * FROM resolutions WHERE id = ? LIMIT 1")
    .bind(input.resolution_id)
    .first<ResolutionRow>();
  if (!res) {
    return { ok: false, error: `Unknown resolution: ${input.resolution_id}` };
  }
  // Already decided -> idempotent no-op, return current state.
  if (res.operator_decision !== "PENDING") {
    return { ok: true, resolution: res };
  }

  await db
    .prepare(
      `UPDATE resolutions
         SET operator_decision = ?, operator_id = ?, operator_note = ?, decided_at = ?
       WHERE id = ? AND operator_decision = 'PENDING'`
    )
    .bind(
      input.decision,
      input.operator_id,
      input.note ?? null,
      nowSeconds(),
      input.resolution_id
    )
    .run();

  const updated = await db
    .prepare("SELECT * FROM resolutions WHERE id = ? LIMIT 1")
    .bind(input.resolution_id)
    .first<ResolutionRow>();
  return { ok: true, resolution: updated as ResolutionRow };
}
