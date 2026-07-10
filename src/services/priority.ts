import type { TransactionRow } from "./triage";

export const W_IMPACT = 0.35;
export const W_URGENCY = 0.3;
export const W_RISK = 0.25;
export const W_CONFIDENCE = 0.1;

export const SLA_SECONDS = {
  FLAGGED: 3600,
  FAILED: 14400,
  PENDING: 86400
} as const;

export const RISK_BY_STATUS = {
  FLAGGED: 1,
  FAILED: 0.6,
  PENDING: 0.3
} as const;

export const IMPACT_CAP = 10_000_000;

export interface PriorityBreakdown {
  impact: number;
  urgency: number;
  risk: number;
  confidence: number;
}

export type ScoredTransaction = TransactionRow & {
  score: number;
  breakdown: PriorityBreakdown;
};

type PriorityStatus = keyof typeof SLA_SECONDS;

function clamp(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function isPriorityStatus(
  status: TransactionRow["status"]
): status is PriorityStatus {
  return status in SLA_SECONDS;
}

/**
 * Score on demand instead of persisting a value: urgency changes as `now` moves,
 * so a stored score would become stale even when the transaction does not change.
 */
export function scoreTransaction(
  txn: TransactionRow,
  opts: { now: number; pendingConfidence: number | null }
): { score: number; breakdown: PriorityBreakdown } {
  if (!isPriorityStatus(txn.status)) {
    throw new Error(`Cannot prioritize transaction with status ${txn.status}`);
  }

  // Impact: logarithmic amount scaling keeps large payments meaningful without domination.
  const impact = clamp(
    Math.log10(1 + txn.amount_minor) / Math.log10(1 + IMPACT_CAP)
  );
  // Urgency: elapsed time relative to the status SLA, capped once the SLA is breached.
  const urgency = clamp((opts.now - txn.created_at) / SLA_SECONDS[txn.status]);
  // Risk: a transparent, fixed operational-risk value for each open status.
  const risk = clamp(RISK_BY_STATUS[txn.status]);
  // Confidence: the latest pending AI proposal contributes only when one exists.
  const confidence = clamp(opts.pendingConfidence ?? 0);

  const score =
    W_IMPACT * impact +
    W_URGENCY * urgency +
    W_RISK * risk +
    W_CONFIDENCE * confidence;

  return { score, breakdown: { impact, urgency, risk, confidence } };
}

export function rankInbox(
  rows: Array<TransactionRow & { pending_confidence: number | null }>,
  now: number
): ScoredTransaction[] {
  return rows
    .map(({ pending_confidence, ...txn }) => ({
      ...txn,
      ...scoreTransaction(txn, { now, pendingConfidence: pending_confidence })
    }))
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.amount_minor !== b.amount_minor) {
        return b.amount_minor - a.amount_minor;
      }
      // Older first among equal-priority items so long-waiting cases are not starved.
      if (a.created_at !== b.created_at) return a.created_at - b.created_at;
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    });
}
