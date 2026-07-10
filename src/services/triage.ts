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

export interface DecisionRow {
  resolution_id: string;
  transaction_id: string;
  merchant_id: string;
  amount_minor: number;
  currency: string;
  txn_status: TransactionRow["status"];
  proposed_action: ResolutionRow["proposed_action"];
  confidence: number | null;
  operator_decision: ResolutionRow["operator_decision"];
  operator_id: string | null;
  operator_note: string | null;
  created_at: number;
  decided_at: number | null;
}

export interface QueryDecisionsOptions {
  decision?: ResolutionRow["operator_decision"];
  q?: string;
  limit: number;
  offset: number;
}

export interface DecisionPage {
  items: DecisionRow[];
  total: number;
  limit: number;
  offset: number;
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

/**
 * Open inbox rows plus the latest still-pending proposal confidence for scoring.
 * The correlated LEFT JOIN keeps transactions without a proposal and avoids N+1 reads.
 */
export interface QueryInboxOptions {
  statuses?: string[];
  q?: string;
  candidateLimit?: number;
}

export async function queryInboxRows(
  db: D1Database,
  opts: QueryInboxOptions = {}
): Promise<Array<TransactionRow & { pending_confidence: number | null }>> {
  const inboxStatuses = opts.statuses ?? ["FAILED", "FLAGGED", "PENDING"];
  if (inboxStatuses.length === 0) return [];

  const placeholders = inboxStatuses
    .map((_, index) => `?${index + 1}`)
    .join(", ");
  const bindings: Array<string | number> = [...inboxStatuses];
  const searchTerm = opts.q?.trim();
  let searchClause = "";
  if (searchTerm) {
    // Escape LIKE wildcards (and the escape character itself) so operator input
    // is always treated as a literal substring.
    const escapedTerm = searchTerm.toLowerCase().replace(/[\\%_]/g, "\\$&");
    bindings.push(`%${escapedTerm}%`);
    const searchPlaceholder = `?${bindings.length}`;
    searchClause = `
       AND (
         LOWER(transactions.id) LIKE ${searchPlaceholder} ESCAPE '\\'
         OR LOWER(transactions.merchant_id) LIKE ${searchPlaceholder} ESCAPE '\\'
         OR LOWER(COALESCE(transactions.gateway_ref, '')) LIKE ${searchPlaceholder} ESCAPE '\\'
         OR LOWER(COALESCE(transactions.failure_code, '')) LIKE ${searchPlaceholder} ESCAPE '\\'
       )`;
  }

  // Bound the candidate scan so a large backlog can't force an unbounded read;
  // the caller ranks these on-the-fly before paging the bounded result set.
  bindings.push(opts.candidateLimit ?? 500);
  const limitPlaceholder = `?${bindings.length}`;
  const { results } = await db
    .prepare(
      `SELECT transactions.*, pending_resolution.confidence AS pending_confidence
       FROM transactions
       LEFT JOIN resolutions AS pending_resolution
         ON pending_resolution.id = (
           SELECT resolution.id
           FROM resolutions AS resolution
           WHERE resolution.transaction_id = transactions.id
             AND resolution.operator_decision = 'PENDING'
           ORDER BY resolution.created_at DESC, resolution.id DESC
           LIMIT 1
         )
       WHERE transactions.status IN (${placeholders})${searchClause}
       ORDER BY transactions.created_at DESC
       LIMIT ${limitPlaceholder}`
    )
    .bind(...bindings)
    .all<TransactionRow & { pending_confidence: number | null }>();
  return results ?? [];
}

const DECISION_QUERY_LIMIT_CAP = 5_000;

/** Paginated resolution audit history joined with its transaction context. */
export async function queryDecisions(
  db: D1Database,
  opts: QueryDecisionsOptions
): Promise<DecisionPage> {
  const filters: string[] = [];
  const bindings: Array<string | number> = [];

  if (opts.decision) {
    bindings.push(opts.decision);
    filters.push(`resolutions.operator_decision = ?${bindings.length}`);
  }

  const searchTerm = opts.q?.trim();
  if (searchTerm) {
    const escapedTerm = searchTerm.toLowerCase().replace(/[\\%_]/g, "\\$&");
    bindings.push(`%${escapedTerm}%`);
    const searchPlaceholder = `?${bindings.length}`;
    filters.push(`(
      LOWER(resolutions.transaction_id) LIKE ${searchPlaceholder} ESCAPE '\\'
      OR LOWER(transactions.merchant_id) LIKE ${searchPlaceholder} ESCAPE '\\'
      OR LOWER(COALESCE(resolutions.operator_note, '')) LIKE ${searchPlaceholder} ESCAPE '\\'
    )`);
  }

  const whereClause = filters.length
    ? `WHERE ${filters.join("\n         AND ")}`
    : "";
  const limit = Math.min(
    Math.max(1, Math.trunc(opts.limit)),
    DECISION_QUERY_LIMIT_CAP
  );
  const offset = Math.max(0, Math.trunc(opts.offset));

  const countStatement = db.prepare(
    `SELECT COUNT(*) AS total
     FROM resolutions
     INNER JOIN transactions ON transactions.id = resolutions.transaction_id
     ${whereClause}`
  );
  const countRow = bindings.length
    ? await countStatement.bind(...bindings).first<{ total: number }>()
    : await countStatement.first<{ total: number }>();

  const pageBindings = [...bindings, limit, offset];
  const limitPlaceholder = `?${bindings.length + 1}`;
  const offsetPlaceholder = `?${bindings.length + 2}`;
  const { results } = await db
    .prepare(
      `SELECT resolutions.id AS resolution_id,
              resolutions.transaction_id,
              transactions.merchant_id,
              transactions.amount_minor,
              transactions.currency,
              transactions.status AS txn_status,
              resolutions.proposed_action,
              resolutions.confidence,
              resolutions.operator_decision,
              resolutions.operator_id,
              resolutions.operator_note,
              resolutions.created_at,
              resolutions.decided_at
       FROM resolutions
       INNER JOIN transactions ON transactions.id = resolutions.transaction_id
       ${whereClause}
       ORDER BY COALESCE(resolutions.decided_at, resolutions.created_at) DESC,
                resolutions.id DESC
       LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`
    )
    .bind(...pageBindings)
    .all<DecisionRow>();

  return {
    items: results ?? [],
    total: countRow?.total ?? 0,
    limit,
    offset
  };
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
