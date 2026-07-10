import { SLA_SECONDS } from "./priority";

const OPEN_STATUSES = ["FAILED", "FLAGGED", "PENDING"] as const;
const PROPOSAL_ACTIONS = ["RETRY", "ESCALATE", "REFUND"] as const;
const OPERATOR_DECISIONS = ["APPROVED", "REJECTED", "PENDING"] as const;

type OpenStatus = (typeof OPEN_STATUSES)[number];
type ProposalAction = (typeof PROPOSAL_ACTIONS)[number];
type OperatorDecision = (typeof OPERATOR_DECISIONS)[number];

interface CountByStatusRow {
  status: string;
  count: number;
}

interface SlaBreachCountRow {
  count: number;
}

interface ProposalAggregateRow {
  proposed_action: ProposalAction;
  count: number;
  confidence_count: number;
  confidence_sum: number | null;
}

interface DecisionAggregateRow {
  operator_decision: OperatorDecision;
  count: number;
}

export interface Stats {
  totalTransactions: number;
  open: {
    total: number;
    byStatus: Record<OpenStatus, number>;
  };
  slaBreaches: number;
  proposals: {
    total: number;
    byAction: Record<ProposalAction, number>;
    avgConfidence: number | null;
  };
  decisions: {
    approved: number;
    rejected: number;
    pending: number;
    approvalRate: number | null;
  };
}

export async function getStats(db: D1Database, now: number): Promise<Stats> {
  const flaggedSlaThreshold = now - SLA_SECONDS.FLAGGED;
  const failedSlaThreshold = now - SLA_SECONDS.FAILED;
  const pendingSlaThreshold = now - SLA_SECONDS.PENDING;

  const [transactionCounts, slaBreachCount, proposalCounts, decisionCounts] =
    (await db.batch([
      db.prepare(
        `SELECT status, COUNT(*) AS count
           FROM transactions
           GROUP BY status`
      ),
      db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM transactions
           WHERE (status='FLAGGED' AND created_at < ?1)
              OR (status='FAILED'  AND created_at < ?2)
              OR (status='PENDING' AND created_at < ?3)`
        )
        .bind(flaggedSlaThreshold, failedSlaThreshold, pendingSlaThreshold),
      db.prepare(
        `SELECT proposed_action,
                  COUNT(*) AS count,
                  COUNT(confidence) AS confidence_count,
                  SUM(confidence) AS confidence_sum
           FROM resolutions
           WHERE proposed_action IN ('RETRY', 'ESCALATE', 'REFUND')
           GROUP BY proposed_action`
      ),
      db.prepare(
        `SELECT operator_decision, COUNT(*) AS count
           FROM resolutions
           GROUP BY operator_decision`
      )
    ])) as [
      D1Result<CountByStatusRow>,
      D1Result<SlaBreachCountRow>,
      D1Result<ProposalAggregateRow>,
      D1Result<DecisionAggregateRow>
    ];

  const byStatus: Record<OpenStatus, number> = {
    FAILED: 0,
    FLAGGED: 0,
    PENDING: 0
  };
  let totalTransactions = 0;
  for (const row of transactionCounts.results ?? []) {
    const count = Number(row.count);
    totalTransactions += count;
    if (OPEN_STATUSES.includes(row.status as OpenStatus)) {
      byStatus[row.status as OpenStatus] = count;
    }
  }

  const slaBreaches = Number(slaBreachCount.results?.[0]?.count ?? 0);

  const byAction: Record<ProposalAction, number> = {
    RETRY: 0,
    ESCALATE: 0,
    REFUND: 0
  };
  let proposalTotal = 0;
  let confidenceCount = 0;
  let confidenceSum = 0;
  for (const row of proposalCounts.results ?? []) {
    const count = Number(row.count);
    byAction[row.proposed_action] = count;
    proposalTotal += count;
    confidenceCount += Number(row.confidence_count);
    confidenceSum += Number(row.confidence_sum ?? 0);
  }

  const decisions: Record<OperatorDecision, number> = {
    APPROVED: 0,
    REJECTED: 0,
    PENDING: 0
  };
  for (const row of decisionCounts.results ?? []) {
    decisions[row.operator_decision] = Number(row.count);
  }
  const decided = decisions.APPROVED + decisions.REJECTED;

  return {
    totalTransactions,
    open: {
      total: byStatus.FAILED + byStatus.FLAGGED + byStatus.PENDING,
      byStatus
    },
    slaBreaches,
    proposals: {
      total: proposalTotal,
      byAction,
      avgConfidence:
        confidenceCount === 0 ? null : confidenceSum / confidenceCount
    },
    decisions: {
      approved: decisions.APPROVED,
      rejected: decisions.REJECTED,
      pending: decisions.PENDING,
      approvalRate: decided === 0 ? null : decisions.APPROVED / decided
    }
  };
}
