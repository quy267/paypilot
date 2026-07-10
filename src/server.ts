import { createWorkersAI } from "workers-ai-provider";
import { routeAgentRequest } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { convertToModelMessages, pruneMessages, streamText } from "ai";
import { z } from "zod";
import {
  buildEvidence,
  decideResolution,
  getTransaction,
  listResolutions,
  queryDecisions,
  queryInboxRows
} from "./services/triage";
import { rankInbox } from "./services/priority";
import { inboxQuerySchema, sortScoredInbox } from "./services/inbox-query";
import { getStats } from "./services/stats";
import { toCsv } from "./lib/csv";
import {
  ACTION_LABEL,
  DECISION_LABEL,
  formatEpochSeconds,
  vnd
} from "./lib/format";
import {
  SYSTEM_PROMPT,
  TRIAGE_MODEL_ID,
  TRIAGE_STOP,
  buildTriageTools
} from "./agent/triage-core";

export class TriageAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;

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

const SESSION_COOKIE = "__Host-pp_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const textEncoder = new TextEncoder();
const integerDecisionQueryParam = z.string().regex(/^\d+$/).transform(Number);
const decisionFilterShape = {
  decision: z.enum(["APPROVED", "REJECTED", "PENDING"]).optional(),
  q: z
    .string()
    .trim()
    .max(100)
    .transform((value) => value || undefined)
    .optional()
};
const decisionsQuerySchema = z
  .object({
    ...decisionFilterShape,
    limit: integerDecisionQueryParam
      .pipe(z.number().int().min(1).max(100))
      .optional(),
    offset: integerDecisionQueryParam.pipe(z.number().int().min(0)).optional()
  })
  .transform((query) => ({
    ...query,
    limit: query.limit ?? 25,
    offset: query.offset ?? 0
  }));
const decisionExportQuerySchema = z.object(decisionFilterShape);

function excelSafeText(value: string | null): string | null {
  if (value === null || !/^[=+\-@\t\r]/.test(value)) return value;
  return `'${value}`;
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return hex(await crypto.subtle.sign("HMAC", key, textEncoder.encode(value)));
}

async function sha256Hex(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", textEncoder.encode(value)));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function getCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const equalsAt = part.indexOf("=");
    if (equalsAt === -1) continue;
    const cookieName = part.slice(0, equalsAt).trim();
    if (cookieName === name) return part.slice(equalsAt + 1).trim();
  }
  return null;
}

async function sessionToken(env: Env): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const expString = String(exp);
  return `${expString}.${await hmacHex(env.OWNER_KEY, expString)}`;
}

async function isAuthed(request: Request, env: Env): Promise<boolean> {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return false;

  const dotAt = token.indexOf(".");
  if (dotAt <= 0 || dotAt === token.length - 1) return false;

  const expString = token.slice(0, dotAt);
  const cookieHmac = token.slice(dotAt + 1);
  if (!/^\d+$/.test(expString)) return false;

  const exp = Number(expString);
  if (!Number.isSafeInteger(exp) || exp <= Math.floor(Date.now() / 1000)) {
    return false;
  }

  const expectedHmac = await hmacHex(env.OWNER_KEY, expString);
  return constantTimeEqual(expectedHmac, cookieHmac);
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  // Only state-changing POSTs and the WS upgrade call this, and browsers always send
  // Origin on those. A missing Origin therefore means a non-browser/forged request — reject.
  if (!origin) return false;
  const url = new URL(request.url);
  return origin === `https://${url.host}` || origin === "http://localhost:5173";
}

async function hasOwnerKey(key: unknown, env: Env): Promise<boolean> {
  const submittedKey = typeof key === "string" ? key : "";
  const [submittedHash, ownerHash] = await Promise.all([
    sha256Hex(submittedKey),
    sha256Hex(env.OWNER_KEY)
  ]);
  return constantTimeEqual(submittedHash, ownerHash);
}

/**
 * PayPilot JSON API for the inbox UI. These routes are how the React app reads
 * data and records operator decisions — separate from the agent's tools so the
 * audit trail never depends on an approval-gated tool's execute path.
 * `/api/*` is listed in wrangler.jsonc `run_worker_first` so it reaches here.
 */
async function handleApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const { pathname } = url;
  const json = (data: unknown, status = 200, headers?: HeadersInit) => {
    const responseHeaders = new Headers(headers);
    responseHeaders.set("content-type", "application/json");
    return new Response(JSON.stringify(data), {
      status,
      headers: responseHeaders
    });
  };

  if (!pathname.startsWith("/api/")) return null;

  const isLogin = pathname === "/api/login" && request.method === "POST";
  if (!isLogin && !(await isAuthed(request, env))) {
    return json({ error: "unauthorized" }, 401);
  }

  if (isLogin) {
    if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
    const body = (await request.json().catch(() => ({}))) as { key?: unknown };
    if (!(await hasOwnerKey(body.key, env))) {
      return json({ error: "unauthorized" }, 401);
    }
    return json({ ok: true }, 200, {
      "Set-Cookie": `${SESSION_COOKIE}=${await sessionToken(env)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`
    });
  }

  if (pathname === "/api/logout" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
    return json({ ok: true }, 200, {
      "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
    });
  }

  if (pathname === "/api/me" && request.method === "GET") {
    return json({ authed: true });
  }

  if (pathname === "/api/stats" && request.method === "GET") {
    return json(await getStats(env.DB, Math.floor(Date.now() / 1000)));
  }

  if (pathname === "/api/inbox" && request.method === "GET") {
    const parsedQuery = inboxQuerySchema.safeParse(
      Object.fromEntries(url.searchParams.entries())
    );
    if (!parsedQuery.success) {
      return json(
        {
          error: "Tham số truy vấn không hợp lệ",
          code: "invalid_query"
        },
        400
      );
    }

    const { status, q, sort, order, limit, offset } = parsedQuery.data;
    const candidates = await queryInboxRows(env.DB, {
      statuses: status ? [status] : undefined,
      q
    });
    const scored = rankInbox(candidates, Math.floor(Date.now() / 1000));

    sortScoredInbox(scored, sort, order);

    // `total` covers only the bounded candidate set returned by queryInboxRows.
    const total = scored.length;
    return json({
      transactions: scored.slice(offset, offset + limit),
      total,
      limit,
      offset
    });
  }

  if (pathname === "/api/decisions" && request.method === "GET") {
    const parsedQuery = decisionsQuerySchema.safeParse(
      Object.fromEntries(url.searchParams.entries())
    );
    if (!parsedQuery.success) {
      return json(
        {
          error: "Tham số truy vấn không hợp lệ",
          code: "invalid_query"
        },
        400
      );
    }

    const { decision, q, limit, offset } = parsedQuery.data;
    const page = await queryDecisions(env.DB, {
      decision,
      q,
      limit,
      offset
    });
    return json({
      decisions: page.items,
      total: page.total,
      limit: page.limit,
      offset: page.offset
    });
  }

  if (pathname === "/api/export/decisions.csv" && request.method === "GET") {
    const parsedQuery = decisionExportQuerySchema.safeParse(
      Object.fromEntries(url.searchParams.entries())
    );
    if (!parsedQuery.success) {
      return json(
        {
          error: "Tham số truy vấn không hợp lệ",
          code: "invalid_query"
        },
        400
      );
    }

    const page = await queryDecisions(env.DB, {
      ...parsedQuery.data,
      limit: 5_000,
      offset: 0
    });
    const csv = toCsv(
      [
        "Thời điểm",
        "Mã GD",
        "Merchant",
        "Số tiền",
        "Hành động",
        "Độ tự tin",
        "Quyết định",
        "Người duyệt",
        "Ghi chú"
      ],
      page.items.map((decision) => [
        formatEpochSeconds(decision.decided_at ?? decision.created_at),
        excelSafeText(decision.transaction_id),
        excelSafeText(decision.merchant_id),
        vnd(decision.amount_minor, decision.currency),
        decision.proposed_action
          ? ACTION_LABEL[decision.proposed_action]
          : null,
        decision.confidence === null
          ? null
          : `${Math.round(decision.confidence * 100)}%`,
        DECISION_LABEL[decision.operator_decision],
        excelSafeText(decision.operator_id),
        excelSafeText(decision.operator_note)
      ])
    );

    return new Response(`\uFEFF${csv}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="paypilot-decisions.csv"'
      }
    });
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
    if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
    const id = decodeURIComponent(decideMatch[1]);
    const body = (await request.json().catch(() => ({}))) as {
      decision?: string;
      note?: string;
    };
    if (body.decision !== "APPROVED" && body.decision !== "REJECTED") {
      return json({ error: "decision must be APPROVED or REJECTED" }, 400);
    }
    const res = await decideResolution(env.DB, {
      resolution_id: id,
      decision: body.decision,
      operator_id: "owner",
      note: body.note
    });
    return json(res, res.ok ? 200 : 400);
  }

  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env) {
    const apiResponse = await handleApi(request, env);
    if (apiResponse) return apiResponse;
    return (
      (await routeAgentRequest(request, env, {
        onBeforeConnect: async (req) =>
          (await isAuthed(req, env)) && sameOrigin(req)
            ? undefined
            : new Response("unauthorized", { status: 401 }),
        onBeforeRequest: async (req) =>
          (await isAuthed(req, env))
            ? undefined
            : new Response("unauthorized", { status: 401 })
      })) || new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
