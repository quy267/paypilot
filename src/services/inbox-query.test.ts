import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inboxQuerySchema, sortScoredInbox } from "./inbox-query";
import type { ScoredTransaction } from "./priority";
import { queryInboxRows } from "./triage";

function asD1Database(sqlite: DatabaseSync): D1Database {
  return {
    prepare(query: string) {
      const statement = sqlite.prepare(query);
      let bindings: SQLInputValue[] = [];
      const prepared = {
        bind(...values: unknown[]) {
          bindings = values as SQLInputValue[];
          return prepared;
        },
        async all<T>() {
          const namedBindings = Object.fromEntries(
            bindings.map((value, index) => [`?${index + 1}`, value])
          );
          return { results: statement.all(namedBindings) as T[] };
        }
      };
      return prepared as unknown as D1PreparedStatement;
    }
  } as unknown as D1Database;
}

function insertTransactions(sqlite: DatabaseSync): void {
  const insert = sqlite.prepare(
    `INSERT INTO transactions
       (id, merchant_id, gateway_ref, amount_minor, currency, method, status,
        failure_code, failure_reason, created_at)
     VALUES (?, ?, ?, ?, 'VND', 'QR', ?, ?, ?, ?)`
  );
  insert.run(
    "txn-small",
    "merchant-alpha",
    "GW-ABC",
    100,
    "FAILED",
    "TIMEOUT",
    "Gateway timeout",
    1_000
  );
  insert.run(
    "txn-pending",
    "merchant-beta",
    null,
    500,
    "PENDING",
    "WAITING",
    "Waiting for confirmation",
    2_000
  );
  insert.run(
    "txn_%literal",
    "merchant-literal",
    "GW-LITERAL",
    700,
    "FAILED",
    "DECLINED",
    "Literal wildcard fixture",
    3_000
  );
  insert.run(
    "txn-flagged",
    "merchant-risk",
    "GW-RISK",
    900,
    "FLAGGED",
    "RISK-REVIEW",
    "Risk review",
    4_000
  );
}

function parseQuery(query: string) {
  const searchParams = new URL(`https://paypilot.test/${query}`).searchParams;
  return inboxQuerySchema.safeParse(Object.fromEntries(searchParams.entries()));
}

function scored(
  overrides: Partial<ScoredTransaction> & Pick<ScoredTransaction, "id">
): ScoredTransaction {
  const { id, ...rest } = overrides;
  return {
    id,
    merchant_id: "merchant",
    gateway_ref: null,
    amount_minor: 100,
    currency: "VND",
    method: "QR",
    status: "FAILED",
    failure_code: null,
    failure_reason: null,
    created_at: 1_000,
    score: 0.5,
    breakdown: { impact: 0.5, urgency: 0.5, risk: 0.5, confidence: 0.5 },
    ...rest
  };
}

describe("inbox query validation", () => {
  it("applies defaults and trims optional searches", () => {
    const defaults = parseQuery("");
    const populated = parseQuery(
      "?status=FAILED&q=%20TIMEOUT%20&sort=age&order=asc&limit=10&offset=20"
    );

    expect(defaults.success).toBe(true);
    expect(populated.success).toBe(true);
    if (defaults.success) {
      expect(defaults.data).toMatchObject({
        sort: "score",
        order: "desc",
        limit: 25,
        offset: 0
      });
    }
    if (populated.success) {
      expect(populated.data).toEqual({
        status: "FAILED",
        q: "TIMEOUT",
        sort: "age",
        order: "asc",
        limit: 10,
        offset: 20
      });
    }
  });

  it.each([
    "?status=SUCCESS",
    "?sort=unknown",
    "?order=sideways",
    "?limit=0",
    "?limit=101",
    "?offset=-1"
  ])("rejects invalid params: %s", (query) => {
    expect(parseQuery(query).success).toBe(false);
  });

  it("strips unknown params instead of failing the request", () => {
    const parsed = parseQuery("?extra=value&utm_source=x");
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("extra");
      expect(parsed.data).not.toHaveProperty("utm_source");
    }
  });

  it("ignores empty searches and rejects searches over 100 characters", () => {
    const empty = parseQuery("?q=%20%20%20");
    expect(empty.success).toBe(true);
    if (empty.success) expect(empty.data.q).toBeUndefined();
    expect(parseQuery(`?q=${"a".repeat(101)}`).success).toBe(false);
  });
});

describe("inbox alternate sorting", () => {
  const ranked = () => [
    scored({
      id: "flagged",
      amount_minor: 900,
      status: "FLAGGED",
      created_at: 4_000,
      score: 0.9
    }),
    scored({
      id: "failed",
      amount_minor: 100,
      status: "FAILED",
      created_at: 2_000,
      score: 0.6
    }),
    scored({
      id: "pending",
      amount_minor: 500,
      status: "PENDING",
      created_at: 3_000,
      score: 0.3
    })
  ];

  it("honors amount and score order", () => {
    expect(
      sortScoredInbox(ranked(), "amount", "asc").map(({ id }) => id)
    ).toEqual(["failed", "pending", "flagged"]);
    expect(
      sortScoredInbox(ranked(), "score", "asc").map(({ id }) => id)
    ).toEqual(["pending", "failed", "flagged"]);
  });

  it("defines descending age as newest first", () => {
    expect(
      sortScoredInbox(ranked(), "age", "desc").map(({ id }) => id)
    ).toEqual(["flagged", "pending", "failed"]);
  });

  it("sorts status by risk severity", () => {
    expect(
      sortScoredInbox(ranked().reverse(), "status", "desc").map(
        ({ status }) => status
      )
    ).toEqual(["FLAGGED", "FAILED", "PENDING"]);
  });

  it("retains Phase 1 priority order when selected keys tie", () => {
    const tied = [
      scored({ id: "priority-first", amount_minor: 500 }),
      scored({ id: "priority-second", amount_minor: 500 })
    ];
    expect(sortScoredInbox(tied, "amount", "desc").map(({ id }) => id)).toEqual(
      ["priority-first", "priority-second"]
    );
  });
});

describe("queryInboxRows", () => {
  let sqlite: DatabaseSync;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec(
      readFileSync(new URL("../../schema.sql", import.meta.url), "utf8")
    );
    insertTransactions(sqlite);
    db = asD1Database(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("searches case-insensitively across the supported fields", async () => {
    await expect(queryInboxRows(db, { q: "gw-abc" })).resolves.toMatchObject([
      { id: "txn-small" }
    ]);
    await expect(
      queryInboxRows(db, { q: "MERCHANT-ALPHA" })
    ).resolves.toMatchObject([{ id: "txn-small" }]);
    await expect(queryInboxRows(db, { q: "waiting" })).resolves.toMatchObject([
      { id: "txn-pending" }
    ]);
  });

  it("treats LIKE wildcards as literal search characters", async () => {
    const percentRows = await queryInboxRows(db, { q: "%" });
    const underscoreRows = await queryInboxRows(db, { q: "_" });
    expect(percentRows.map(({ id }) => id)).toEqual(["txn_%literal"]);
    expect(underscoreRows.map(({ id }) => id)).toEqual(["txn_%literal"]);
  });

  it("applies status and candidate limits while keeping the default behavior", async () => {
    const allRows = await queryInboxRows(db);
    const failedPage = await queryInboxRows(db, {
      statuses: ["FAILED"],
      candidateLimit: 1
    });

    expect(allRows).toHaveLength(4);
    expect(failedPage.map(({ id }) => id)).toEqual(["txn_%literal"]);
  });
});
