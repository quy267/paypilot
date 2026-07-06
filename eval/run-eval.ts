// PayPilot Phase 6 — offline AI eval.
//
// Drives the real triage model (Kimi, via the Workers AI REST API) through the SAME
// system prompt + tools the live agent uses, backed by an in-memory D1 (miniflare)
// seeded from schema.sql + seed.sql. No Durable Object, no WebSocket — this is the
// "bypass the agent runtime, call the model + domain service directly" path.
//
// For each fixture it measures: did the model call proposeResolution, for the right
// transaction, with an acceptable action, and did it chain tools
// (getTransaction before proposeResolution)? Then prints accuracy %.
//
// Run: `npm run eval`. Needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN
// (Workers AI Read) — put them in .dev.vars (git-ignored). See README.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateText } from "ai";
import { Miniflare } from "miniflare";
import { createWorkersAI } from "workers-ai-provider";
import type { ProposedAction } from "../src/services/triage";
import {
  SYSTEM_PROMPT,
  TRIAGE_MODEL_ID,
  TRIAGE_STOP,
  buildTriageTools
} from "../src/agent/triage-core";
import { cases } from "./fixtures";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Load KEY=value lines from .dev.vars into process.env (no dotenv dependency). */
function loadDevVars(): void {
  try {
    const text = readFileSync(join(repoRoot, ".dev.vars"), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // no .dev.vars — fall back to real environment variables
  }
}

/**
 * Split a .sql file into statements on `;`, but only outside string literals and
 * `--` comments — seed.sql has a `;` inside a quoted JSON evidence value, so a naive
 * `split(";")` would cut a statement in half.
 */
function sqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inString = false;
  let inLineComment = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        current += ch;
      }
      continue;
    }
    if (inString) {
      current += ch;
      if (ch === "'") {
        if (next === "'") {
          current += "'"; // escaped quote inside the string
          i++;
        } else {
          inString = false;
        }
      }
      continue;
    }
    if (ch === "-" && next === "-") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inString = true;
      current += ch;
      continue;
    }
    if (ch === ";") {
      const stmt = current.trim();
      if (stmt) statements.push(stmt);
      current = "";
      continue;
    }
    current += ch;
  }
  const last = current.trim();
  if (last) statements.push(last);
  return statements;
}

async function applySql(db: D1Database, file: string): Promise<void> {
  for (const stmt of sqlStatements(
    readFileSync(join(repoRoot, file), "utf8")
  )) {
    await db.prepare(stmt).run();
  }
}

interface Scored {
  id: string;
  proposeCalled: boolean;
  rightTxn: boolean;
  action: string;
  actionOk: boolean;
  chained: boolean;
  guardOk: boolean;
}

async function main(): Promise<void> {
  loadDevVars();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiKey = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiKey) {
    console.error(
      "✗ Thiếu CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN.\n" +
        "  → Thêm 2 dòng vào file .dev.vars (đã git-ignore). Xem README, mục 'Đánh giá AI'.\n" +
        "  → Token: Cloudflare dashboard → My Profile → API Tokens → Create → quyền 'Workers AI: Read'."
    );
    process.exit(1);
  }

  // In-memory D1 with the real schema + seed. The dummy worker script only exists so
  // miniflare hands us a D1 binding; we never fetch the worker.
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('eval'); } };",
    d1Databases: { DB: "paypilot-eval" }
  });
  const DB = (await mf.getD1Database("DB")) as unknown as D1Database;
  await applySql(DB, "schema.sql");
  await applySql(DB, "seed.sql");

  const workersai = createWorkersAI({ accountId, apiKey });
  const model = workersai(TRIAGE_MODEL_ID);

  console.log(
    `\nPayPilot — Đánh giá AI triage · model ${TRIAGE_MODEL_ID} · ${cases.length} ca\n`
  );

  const scored: Scored[] = [];
  let idx = 0;
  for (const c of cases) {
    idx++;
    // Clean slate so the one-pending-per-transaction rule never blocks a proposal.
    // Transactions stay seeded; only proposals reset.
    await DB.prepare("DELETE FROM resolutions").run();

    const startedAt = Date.now();
    let toolNames: string[] = [];
    let action = "-";
    let proposedTxn: string | undefined;
    try {
      const result = await generateText({
        model,
        system: SYSTEM_PROMPT,
        prompt: c.prompt,
        tools: buildTriageTools(DB),
        stopWhen: TRIAGE_STOP,
        temperature: 0,
        // Fail fast instead of the SDK's long exponential backoff — a persistent 429
        // (free-tier neurons exhausted) should surface at once, not after ~70s.
        maxRetries: 1
      });
      // ai SDK v6: `result.toolCalls` holds only the LAST step's tool calls, which
      // is empty when a run ends with a text summary. Aggregate across every step to
      // see the whole list→get→propose chain.
      const allToolCalls = result.steps.flatMap((s) => s.toolCalls);
      toolNames = allToolCalls.map((t) => t.toolName);
      const propose = allToolCalls.find(
        (t) => t.toolName === "proposeResolution"
      );
      const input = (propose?.input ?? {}) as {
        transaction_id?: string;
        action?: string;
      };
      action = input.action ?? "-";
      proposedTxn = input.transaction_id;
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`  ! ${c.id}: lỗi gọi model — ${msg}`);
      if (/neurons|429|too many requests/i.test(msg)) {
        console.error(
          "  ⚠ Hết quota Workers AI free tier (10k neuron/ngày) — dừng eval. " +
            "Chạy lại sau khi reset (00:00 UTC ≈ 07:00 giờ VN)."
        );
        break;
      }
    }

    const proposeCalled = toolNames.includes("proposeResolution");
    const rightTxn = proposedTxn === c.transactionId;
    const actionOk =
      proposeCalled && c.expectedActions.includes(action as ProposedAction);
    const gi = toolNames.indexOf("getTransaction");
    const pi = toolNames.lastIndexOf("proposeResolution");
    const chained = gi !== -1 && pi !== -1 && gi < pi;
    const guardOk = c.refundMustBeBlocked ? action !== "REFUND" : true;

    scored.push({
      id: c.id,
      proposeCalled,
      rightTxn,
      action,
      actionOk,
      chained,
      guardOk
    });

    const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `[${String(idx).padStart(2)}/${cases.length}] ${c.id.padEnd(36)} ` +
        `${action.padEnd(9)} đúng=${actionOk ? "✓" : "✗"} ` +
        `txn=${rightTxn ? "✓" : "✗"} chain=${chained ? "✓" : "✗"} (${secs}s)`
    );
  }

  await mf.dispose();

  const total = scored.length;
  const correct = scored.filter(
    (r) => r.proposeCalled && r.rightTxn && r.actionOk
  ).length;
  const proposed = scored.filter((r) => r.proposeCalled).length;
  const chained = scored.filter((r) => r.chained).length;
  const guardTotal = cases.filter((c) => c.refundMustBeBlocked).length;
  const guardOk = scored.filter(
    (r, i) => cases[i].refundMustBeBlocked && r.guardOk
  ).length;
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

  console.log("\n── Tổng kết ──");
  console.log(
    `  Triage đúng (đúng hành động + đúng giao dịch):    ${correct}/${total} = ${pct(correct, total)}%`
  );
  console.log(
    `  Gọi proposeResolution:                           ${proposed}/${total} = ${pct(proposed, total)}%`
  );
  console.log(
    `  Chain tool (getTransaction → proposeResolution): ${chained}/${total} = ${pct(chained, total)}%`
  );
  console.log(
    `  Guard REFUND-chỉ-FLAGGED được tôn trọng:         ${guardOk}/${guardTotal}`
  );
  console.log("");
}

await main();
