import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import type { TriageAgent } from "./server";
import type { ResolutionRow, TransactionRow } from "./services/triage";
import { Badge, Button, Empty, InputArea, Surface, Text } from "@cloudflare/kumo";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import {
  ArrowsClockwiseIcon,
  BrainIcon,
  CaretDownIcon,
  CheckCircleIcon,
  CircleIcon,
  GearIcon,
  MoonIcon,
  ReceiptIcon,
  SparkleIcon,
  StopIcon,
  SunIcon,
  WarningIcon,
  XCircleIcon
} from "@phosphor-icons/react";

// ── Types coming back from the JSON API ───────────────────────────────
interface TransactionDetail {
  transaction: TransactionRow;
  evidence: Record<string, unknown>;
  resolutions: ResolutionRow[];
}

// ── Display helpers ───────────────────────────────────────────────────

/** Format a minor-unit integer as VND, e.g. 52000000 -> "52.000.000 ₫". */
function vnd(minor: number, currency = "VND"): string {
  const grouped = Math.round(minor)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return currency === "VND" ? `${grouped} ₫` : `${grouped} ${currency}`;
}

// Vietnamese labels for the enum values stored in the DB.
const STATUS_LABEL: Record<string, string> = {
  FAILED: "Lỗi",
  FLAGGED: "Nghi ngờ",
  PENDING: "Đang chờ",
  SUCCESS: "Thành công"
};
const ACTION_LABEL: Record<string, string> = {
  RETRY: "Thử lại",
  ESCALATE: "Chuyển cấp trên",
  REFUND: "Hoàn tiền"
};
const DECISION_LABEL: Record<string, string> = {
  PENDING: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  REJECTED: "Từ chối"
};

/** Tailwind text colour per transaction status (a small status dot). */
function statusColor(status: string): string {
  switch (status) {
    case "FLAGGED":
      return "text-amber-500";
    case "FAILED":
      return "text-red-500";
    case "PENDING":
      return "text-blue-400";
    default:
      return "text-emerald-500";
  }
}

// ── Small components ──────────────────────────────────────────────────

function ThemeToggle() {
  const [dark, setDark] = useState(
    () => document.documentElement.getAttribute("data-mode") === "dark"
  );
  const toggle = useCallback(() => {
    const next = !dark;
    setDark(next);
    const mode = next ? "dark" : "light";
    document.documentElement.setAttribute("data-mode", mode);
    document.documentElement.style.colorScheme = mode;
    localStorage.setItem("theme", mode);
  }, [dark]);
  return (
    <Button
      variant="secondary"
      shape="square"
      icon={dark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
      onClick={toggle}
      aria-label="Đổi giao diện sáng/tối"
    />
  );
}

/** Compact chip for one agent tool call (e.g. "listInbox ✓"). */
function ToolChip({ part }: { part: UIMessage["parts"][number] }) {
  if (!isToolUIPart(part)) return null;
  const name = getToolName(part);
  const running =
    part.state === "input-available" || part.state === "input-streaming";
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-kumo-control text-xs text-kumo-default">
      <GearIcon
        size={12}
        className={running ? "animate-spin text-kumo-brand" : "text-kumo-success"}
      />
      <span className="font-mono">{name}</span>
      {running ? "…" : "✓"}
    </span>
  );
}

/** Renders the agent's live activity: tool chips, reasoning, final text. */
function AgentActivity({
  messages,
  isStreaming
}: {
  messages: UIMessage[];
  isStreaming: boolean;
}) {
  if (messages.length === 0) return null;
  return (
    <div className="space-y-3">
      {messages.map((message, index) => {
        const isUser = message.role === "user";
        const isLastAssistant =
          message.role === "assistant" && index === messages.length - 1;
        const toolParts = message.parts.filter(isToolUIPart);
        const reasoningParts = message.parts.filter(
          (p) => p.type === "reasoning" && (p as { text?: string }).text?.trim()
        );
        const textParts = message.parts.filter((p) => p.type === "text");

        if (isUser) {
          const text = textParts
            .map((p) => (p as { text: string }).text)
            .join(" ");
          if (!text) return null;
          return (
            <div key={message.id} className="text-xs text-kumo-subtle italic">
              ▶ {text}
            </div>
          );
        }

        return (
          <div key={message.id} className="space-y-2">
            {toolParts.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {toolParts.map((part) => (
                  <ToolChip key={part.toolCallId} part={part} />
                ))}
              </div>
            )}

            {reasoningParts.map((part, i) => {
              const r = part as {
                text: string;
                state?: "streaming" | "done";
              };
              const done = r.state === "done" || !isStreaming;
              return (
                <details key={i} open={!done} className="w-full">
                  <summary className="flex items-center gap-2 cursor-pointer px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-xs select-none">
                    <BrainIcon size={13} className="text-purple-400" />
                    <span className="font-medium text-kumo-default">
                      Suy luận của AI
                    </span>
                    <span className="text-kumo-subtle">
                      {done ? "Hoàn tất" : "Đang nghĩ…"}
                    </span>
                    <CaretDownIcon
                      size={13}
                      className="ml-auto text-kumo-inactive"
                    />
                  </summary>
                  <pre className="mt-1.5 px-3 py-2 rounded-lg bg-kumo-control text-xs whitespace-pre-wrap overflow-auto max-h-56">
                    {r.text}
                  </pre>
                </details>
              );
            })}

            {textParts.map((part, i) => {
              const text = (part as { text: string }).text;
              if (!text) return null;
              return (
                <div
                  key={i}
                  className="rounded-xl bg-kumo-base ring ring-kumo-line"
                >
                  <Streamdown
                    className="sd-theme p-3 text-sm"
                    plugins={{ code }}
                    controls={false}
                    isAnimating={isLastAssistant && isStreaming}
                  >
                    {text}
                  </Streamdown>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── Inbox (left pane) ─────────────────────────────────────────────────

function InboxList({
  items,
  selectedId,
  onSelect
}: {
  items: TransactionRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="p-6">
        <Empty
          icon={<CheckCircleIcon size={28} />}
          title="Hộp xử lý trống"
          contents={<Text size="sm" variant="secondary">Không có giao dịch nào cần xử lý.</Text>}
        />
      </div>
    );
  }
  return (
    <ul className="divide-y divide-kumo-line">
      {items.map((t) => {
        const active = t.id === selectedId;
        return (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onSelect(t.id)}
              className={`w-full text-left px-4 py-3 transition-colors ${
                active ? "bg-kumo-control" : "hover:bg-kumo-control/50"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 min-w-0">
                  <CircleIcon
                    size={8}
                    weight="fill"
                    className={statusColor(t.status)}
                  />
                  <span className="font-mono text-sm text-kumo-default truncate">
                    {t.id}
                  </span>
                </span>
                <span className="text-sm font-medium text-kumo-default shrink-0">
                  {vnd(t.amount_minor, t.currency)}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <Badge variant="secondary">{STATUS_LABEL[t.status] ?? t.status}</Badge>
                <span className="text-xs text-kumo-subtle">{t.method}</span>
                {t.failure_reason && (
                  <span className="text-xs text-kumo-subtle truncate">
                    · {t.failure_reason}
                  </span>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ── Transaction detail + resolution (right pane) ──────────────────────

function ResolutionCard({
  resolution,
  onDecide,
  deciding
}: {
  resolution: ResolutionRow;
  onDecide: (id: string, decision: "APPROVED" | "REJECTED") => void;
  deciding: boolean;
}) {
  const pending = resolution.operator_decision === "PENDING";
  return (
    <Surface className="rounded-xl ring ring-kumo-line p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Text size="sm" bold>
          Đề xuất của AI
        </Text>
        <Badge variant={pending ? "primary" : "secondary"}>
          {DECISION_LABEL[resolution.operator_decision]}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span>
          Hành động:{" "}
          <span className="font-semibold text-kumo-default">
            {ACTION_LABEL[resolution.proposed_action ?? ""] ??
              resolution.proposed_action}
          </span>
        </span>
        {resolution.confidence != null && (
          <span className="text-kumo-subtle">
            Độ tin cậy: {(resolution.confidence * 100).toFixed(0)}%
          </span>
        )}
      </div>

      {resolution.ai_diagnosis && (
        <Text size="sm" variant="secondary">
          {resolution.ai_diagnosis}
        </Text>
      )}

      {pending ? (
        <div className="flex gap-2 pt-1">
          <Button
            variant="primary"
            size="sm"
            icon={<CheckCircleIcon size={15} />}
            disabled={deciding}
            onClick={() => onDecide(resolution.id, "APPROVED")}
          >
            Duyệt
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<XCircleIcon size={15} />}
            disabled={deciding}
            onClick={() => onDecide(resolution.id, "REJECTED")}
          >
            Từ chối
          </Button>
        </div>
      ) : (
        <Text size="xs" variant="secondary">
          {resolution.operator_id ? `Bởi ${resolution.operator_id}` : ""}
          {resolution.operator_note ? ` — ${resolution.operator_note}` : ""}
        </Text>
      )}
    </Surface>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <span className="text-kumo-subtle">{label}</span>
      <span className="text-kumo-default font-medium text-right">{value}</span>
    </div>
  );
}

// ── Main app ──────────────────────────────────────────────────────────

function PayPilot() {
  const [connected, setConnected] = useState(false);
  const [inbox, setInbox] = useState<TransactionRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [followUp, setFollowUp] = useState("");
  const wasStreaming = useRef(false);

  const agent = useAgent<TriageAgent>({
    agent: "TriageAgent",
    onOpen: useCallback(() => setConnected(true), []),
    onClose: useCallback(() => setConnected(false), []),
    onError: useCallback(
      (e: Event) => console.error("WebSocket error:", e),
      []
    )
  });

  const { messages, sendMessage, clearHistory, status, stop } = useAgentChat({
    agent
  });
  const isStreaming = status === "streaming" || status === "submitted";

  const refreshInbox = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox");
      const data = (await res.json()) as { transactions?: TransactionRow[] };
      setInbox(data.transactions ?? []);
    } catch (e) {
      console.error("Failed to load inbox:", e);
    }
  }, []);

  const refreshDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/transactions/${id}`);
      if (!res.ok) return;
      setDetail((await res.json()) as TransactionDetail);
    } catch (e) {
      console.error("Failed to load transaction:", e);
    }
  }, []);

  useEffect(() => {
    refreshInbox();
  }, [refreshInbox]);

  // When the agent finishes a run, pick up any resolution it just wrote.
  useEffect(() => {
    if (wasStreaming.current && !isStreaming && selectedId) {
      refreshDetail(selectedId);
      refreshInbox();
    }
    wasStreaming.current = isStreaming;
  }, [isStreaming, selectedId, refreshDetail, refreshInbox]);

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      setDetail(null);
      clearHistory();
      refreshDetail(id);
    },
    [clearHistory, refreshDetail]
  );

  const processWithAI = useCallback(() => {
    if (!selectedId || isStreaming) return;
    clearHistory();
    sendMessage({
      role: "user",
      parts: [
        {
          type: "text",
          text: `Xử lý riêng giao dịch ${selectedId}: gọi getTransaction("${selectedId}"), chẩn đoán nguyên nhân kèm bằng chứng, đề xuất đúng một hành động kèm độ tin cậy, rồi GỌI proposeResolution. Hoàn tất tất cả các bước.`
        }
      ]
    });
  }, [selectedId, isStreaming, clearHistory, sendMessage]);

  const decide = useCallback(
    async (resolutionId: string, decision: "APPROVED" | "REJECTED") => {
      setDeciding(true);
      try {
        await fetch(`/api/resolutions/${resolutionId}/decide`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision, operator_id: "operator" })
        });
        if (selectedId) await refreshDetail(selectedId);
        await refreshInbox();
      } catch (e) {
        console.error("Failed to record decision:", e);
      } finally {
        setDeciding(false);
      }
    },
    [selectedId, refreshDetail, refreshInbox]
  );

  const sendFollowUp = useCallback(() => {
    const text = followUp.trim();
    if (!text || isStreaming) return;
    setFollowUp("");
    sendMessage({ role: "user", parts: [{ type: "text", text }] });
  }, [followUp, isStreaming, sendMessage]);

  const txn = detail?.transaction;
  const latestResolution = detail?.resolutions[0];
  const hasPending = latestResolution?.operator_decision === "PENDING";

  return (
    <div className="flex flex-col h-screen bg-kumo-elevated">
      {/* Header */}
      <header className="px-5 py-3 bg-kumo-base border-b border-kumo-line shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ReceiptIcon size={20} className="text-kumo-brand" weight="fill" />
            <h1 className="text-lg font-semibold text-kumo-default">PayPilot</h1>
            <Badge variant="secondary">Hộp xử lý giao dịch lỗi</Badge>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <CircleIcon
                size={8}
                weight="fill"
                className={connected ? "text-kumo-success" : "text-kumo-danger"}
              />
              <Text size="xs" variant="secondary">
                {connected ? "Đã kết nối" : "Mất kết nối"}
              </Text>
            </span>
            <Button
              variant="secondary"
              shape="square"
              icon={<ArrowsClockwiseIcon size={16} />}
              onClick={refreshInbox}
              aria-label="Tải lại hộp xử lý"
            />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Two-pane body */}
      <div className="flex-1 flex min-h-0">
        {/* Left: inbox */}
        <aside className="w-80 shrink-0 border-r border-kumo-line overflow-y-auto bg-kumo-base">
          <div className="px-4 py-2.5 border-b border-kumo-line">
            <Text size="xs" variant="secondary" bold>
              CẦN XỬ LÝ ({inbox.length})
            </Text>
          </div>
          <InboxList items={inbox} selectedId={selectedId} onSelect={select} />
        </aside>

        {/* Right: detail */}
        <main className="flex-1 overflow-y-auto">
          {!txn ? (
            <div className="h-full flex items-center justify-center">
              <Empty
                icon={<ReceiptIcon size={32} />}
                title="Chọn một giao dịch"
                contents={
                  <Text size="sm" variant="secondary">
                    Chọn một giao dịch ở bên trái để xem chi tiết và xử lý.
                  </Text>
                }
              />
            </div>
          ) : (
            <div className="max-w-2xl mx-auto px-6 py-6 space-y-5">
              {/* Transaction detail */}
              <Surface className="rounded-xl ring ring-kumo-line p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="flex items-center gap-2">
                    <CircleIcon
                      size={9}
                      weight="fill"
                      className={statusColor(txn.status)}
                    />
                    <span className="font-mono text-base text-kumo-default">
                      {txn.id}
                    </span>
                    <Badge variant="secondary">
                      {STATUS_LABEL[txn.status] ?? txn.status}
                    </Badge>
                  </span>
                  <span className="text-lg font-semibold text-kumo-default">
                    {vnd(txn.amount_minor, txn.currency)}
                  </span>
                </div>
                <div className="divide-y divide-kumo-line">
                  <DetailRow label="Cửa hàng" value={txn.merchant_id} />
                  <DetailRow label="Phương thức" value={txn.method} />
                  {txn.failure_code && (
                    <DetailRow
                      label="Mã lỗi"
                      value={<span className="font-mono">{txn.failure_code}</span>}
                    />
                  )}
                  {txn.failure_reason && (
                    <DetailRow label="Lý do" value={txn.failure_reason} />
                  )}
                  {txn.gateway_ref && (
                    <DetailRow
                      label="Mã cổng"
                      value={<span className="font-mono">{txn.gateway_ref}</span>}
                    />
                  )}
                </div>
              </Surface>

              {/* Resolution / action */}
              {latestResolution ? (
                <ResolutionCard
                  resolution={latestResolution}
                  onDecide={decide}
                  deciding={deciding}
                />
              ) : (
                <Surface className="rounded-xl ring ring-kumo-line p-4 flex items-center justify-between">
                  <Text size="sm" variant="secondary">
                    Chưa có đề xuất. Để AI phân tích và đề xuất hướng xử lý.
                  </Text>
                  <Button
                    variant="primary"
                    icon={<SparkleIcon size={15} />}
                    onClick={processWithAI}
                    disabled={isStreaming || !connected}
                  >
                    Xử lý bằng AI
                  </Button>
                </Surface>
              )}

              {/* Agent activity */}
              {(messages.length > 0 || isStreaming) && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Text size="xs" variant="secondary" bold>
                      AI ĐANG XỬ LÝ
                    </Text>
                    {isStreaming && (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<StopIcon size={13} />}
                        onClick={stop}
                      >
                        Dừng
                      </Button>
                    )}
                  </div>
                  <AgentActivity messages={messages} isStreaming={isStreaming} />

                  {/* Follow-up question to the agent */}
                  <div className="flex items-end gap-2 rounded-xl border border-kumo-line bg-kumo-base p-2">
                    <InputArea
                      value={followUp}
                      onValueChange={setFollowUp}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          sendFollowUp();
                        }
                      }}
                      placeholder="Hỏi thêm AI về giao dịch này…"
                      disabled={!connected || isStreaming}
                      rows={1}
                      className="flex-1 ring-0! focus:ring-0! shadow-none! bg-transparent! resize-none max-h-32"
                    />
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={sendFollowUp}
                      disabled={!followUp.trim() || isStreaming || !connected}
                    >
                      Gửi
                    </Button>
                  </div>
                </div>
              )}

              {/* Warning if AI couldn't propose (e.g. duplicate pending) */}
              {!latestResolution && !isStreaming && messages.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-amber-500">
                  <WarningIcon size={14} />
                  Nếu AI dừng sớm, bấm "Xử lý bằng AI" lại hoặc hỏi thêm ở trên.
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen text-kumo-inactive">
          Đang tải…
        </div>
      }
    >
      <PayPilot />
    </Suspense>
  );
}
