import { describe, expect, it } from "vitest";
import type { TransactionRow } from "./triage";
import {
  IMPACT_CAP,
  RISK_BY_STATUS,
  SLA_SECONDS,
  W_CONFIDENCE,
  W_IMPACT,
  W_RISK,
  W_URGENCY,
  rankInbox,
  scoreTransaction
} from "./priority";

const NOW = 1_800_000_000;

function transaction(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: "txn_default",
    merchant_id: "merchant_1",
    gateway_ref: null,
    amount_minor: 100_000,
    currency: "VND",
    method: "QR",
    status: "FAILED",
    failure_code: "TIMEOUT",
    failure_reason: "Gateway timeout",
    created_at: NOW,
    ...overrides
  };
}

function scoredBreakdown(
  overrides: Partial<TransactionRow>,
  pendingConfidence: number | null = null
) {
  return scoreTransaction(transaction(overrides), {
    now: NOW,
    pendingConfidence
  }).breakdown;
}

describe("scoreTransaction", () => {
  it("exports the fixed scoring configuration", () => {
    expect({
      weights: [W_IMPACT, W_URGENCY, W_RISK, W_CONFIDENCE],
      sla: SLA_SECONDS,
      risk: RISK_BY_STATUS,
      impactCap: IMPACT_CAP
    }).toEqual({
      weights: [0.35, 0.3, 0.25, 0.1],
      sla: { FLAGGED: 3600, FAILED: 14400, PENDING: 86400 },
      risk: { FLAGGED: 1, FAILED: 0.6, PENDING: 0.3 },
      impactCap: 10_000_000
    });
  });

  it("increases impact as the amount rises", () => {
    const small = scoredBreakdown({ amount_minor: 10_000 }).impact;
    const large = scoredBreakdown({ amount_minor: 1_000_000 }).impact;
    const malformed = scoredBreakdown({ amount_minor: -2 }).impact;
    expect([large > small, malformed]).toEqual([true, 0]);
  });

  it("increases urgency with age and saturates after the status SLA", () => {
    const fresh = scoredBreakdown({ created_at: NOW }).urgency;
    const halfway = scoredBreakdown({
      created_at: NOW - SLA_SECONDS.FAILED / 2
    }).urgency;
    const overdue = scoredBreakdown({
      created_at: NOW - SLA_SECONDS.FAILED * 2
    }).urgency;

    expect(fresh).toBe(0);
    expect(halfway).toBeCloseTo(0.5);
    expect(overdue).toBe(1);
  });

  it("orders status risk as FLAGGED, FAILED, then PENDING", () => {
    expect([
      scoredBreakdown({ status: "FLAGGED" }).risk,
      scoredBreakdown({ status: "FAILED" }).risk,
      scoredBreakdown({ status: "PENDING" }).risk
    ]).toEqual([
      RISK_BY_STATUS.FLAGGED,
      RISK_BY_STATUS.FAILED,
      RISK_BY_STATUS.PENDING
    ]);
  });

  it("passes pending confidence through and defaults null to zero", () => {
    expect(scoredBreakdown({}, 0.72).confidence).toBe(0.72);
    expect(scoredBreakdown({}, null).confidence).toBe(0);
  });

  it("combines factors using the exported weights", () => {
    const { score } = scoreTransaction(
      transaction({
        amount_minor: IMPACT_CAP,
        status: "FAILED",
        created_at: NOW - SLA_SECONDS.FAILED / 2
      }),
      { now: NOW, pendingConfidence: 0.8 }
    );

    expect(score).toBeCloseTo(
      W_IMPACT * 1 +
        W_URGENCY * 0.5 +
        W_RISK * RISK_BY_STATUS.FAILED +
        W_CONFIDENCE * 0.8
    );
  });
});

describe("rankInbox", () => {
  const row = (
    overrides: Partial<TransactionRow> & { pending_confidence?: number | null }
  ) => ({
    ...transaction({
      status: "FLAGGED",
      amount_minor: IMPACT_CAP,
      created_at: NOW - SLA_SECONDS.FLAGGED * 2
    }),
    pending_confidence: null,
    ...overrides
  });

  it("breaks equal-score ties by amount descending", () => {
    const ranked = rankInbox(
      [
        row({ id: "txn_lower", amount_minor: IMPACT_CAP }),
        row({ id: "txn_higher", amount_minor: IMPACT_CAP * 2 }),
        row({
          id: "txn_lower_score",
          status: "PENDING",
          amount_minor: 0,
          created_at: NOW
        })
      ],
      NOW
    );
    expect(ranked.map(({ id }) => id)).toEqual([
      "txn_higher",
      "txn_lower",
      "txn_lower_score"
    ]);
  });

  it("then breaks ties by created_at ascending (older first)", () => {
    const ranked = rankInbox(
      [
        row({ id: "txn_older", created_at: NOW - SLA_SECONDS.FLAGGED * 3 }),
        row({ id: "txn_newer", created_at: NOW - SLA_SECONDS.FLAGGED * 2 })
      ],
      NOW
    );
    expect(ranked.map(({ id }) => id)).toEqual(["txn_older", "txn_newer"]);
  });

  it("finally breaks ties by id ascending", () => {
    const ranked = rankInbox([row({ id: "txn_b" }), row({ id: "txn_a" })], NOW);
    expect(ranked.map(({ id }) => id)).toEqual(["txn_a", "txn_b"]);
  });
});
