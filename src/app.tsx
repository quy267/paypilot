import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import {
  Compass,
  LogOut,
  RefreshCw,
  Sparkles,
  TriangleAlert
} from "lucide-react";
import type { TriageAgent } from "./server";
import type { ResolutionRow, TransactionRow } from "@/services/triage";
import type { ScoredTransaction } from "@/services/priority";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { LoginScreen } from "@/components/login-screen";
import { InboxList } from "@/components/inbox-list";
import { TransactionDetail } from "@/components/transaction-detail";
import { ResolutionCard } from "@/components/resolution-card";
import { AgentActivity } from "@/components/agent-activity";

interface TransactionDetailData {
  transaction: TransactionRow;
  evidence: Record<string, unknown>;
  resolutions: ResolutionRow[];
}

interface PayPilotProps {
  onLogout: () => void;
}

function PayPilot({ onLogout }: PayPilotProps) {
  const [connected, setConnected] = useState(false);
  const [inbox, setInbox] = useState<ScoredTransaction[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TransactionDetailData | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [followUp, setFollowUp] = useState("");
  const wasStreaming = useRef(false);
  // Guards against a slow /api/transactions response overwriting a newer selection.
  const latestDetailReq = useRef<string | null>(null);
  // The chat library's streaming `status` can get stuck after a run finishes, so we
  // can't rely on it to know a triage is done. `triaging` is our own "AI run in
  // progress" flag that drives the UI, and `activeTriageId` records which
  // transaction the run belongs to so a poll for a stale selection bails out.
  const [triaging, setTriaging] = useState(false);
  const activeTriageId = useRef<string | null>(null);

  const agent = useAgent<TriageAgent>({
    agent: "TriageAgent",
    onOpen: useCallback(() => setConnected(true), []),
    onClose: useCallback(() => setConnected(false), []),
    onError: useCallback((e: Event) => console.error("WebSocket error:", e), [])
  });

  const { messages, sendMessage, clearHistory, status, stop } = useAgentChat({
    agent
  });
  const isStreaming = status === "streaming" || status === "submitted";

  const refreshInbox = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox");
      const data = (await res.json()) as { transactions?: ScoredTransaction[] };
      setInbox(data.transactions ?? []);
    } catch (e) {
      console.error("Failed to load inbox:", e);
    }
  }, []);

  const refreshDetail = useCallback(async (id: string) => {
    latestDetailReq.current = id;
    try {
      const res = await fetch(`/api/transactions/${id}`);
      if (!res.ok) return;
      const data = (await res.json()) as TransactionDetailData;
      // Ignore a slow response if a newer transaction was selected meanwhile.
      if (latestDetailReq.current === id) setDetail(data);
    } catch (e) {
      console.error("Failed to load transaction:", e);
    }
  }, []);

  useEffect(() => {
    refreshInbox();
  }, [refreshInbox]);

  // When an agent run finishes, pick up any resolution it just wrote.
  useEffect(() => {
    if (wasStreaming.current && !isStreaming && selectedId) {
      refreshDetail(selectedId);
      refreshInbox();
    }
    wasStreaming.current = isStreaming;
  }, [isStreaming, selectedId, refreshDetail, refreshInbox]);

  const select = useCallback(
    (id: string) => {
      // Cancel any in-flight triage poll tied to the previously selected txn.
      activeTriageId.current = null;
      setTriaging(false);
      setSelectedId(id);
      setDetail(null);
      clearHistory();
      refreshDetail(id);
    },
    [clearHistory, refreshDetail]
  );

  const processWithAI = useCallback(async () => {
    if (!selectedId || triaging) return;
    const id = selectedId;
    activeTriageId.current = id;
    setTriaging(true);
    clearHistory();
    // Forceful, step-numbered prompt: the free Kimi model only chains tools reliably this way.
    sendMessage({
      role: "user",
      parts: [
        {
          type: "text",
          text: `Xử lý riêng giao dịch ${id}: gọi getTransaction("${id}"), chẩn đoán nguyên nhân kèm bằng chứng, đề xuất đúng một hành động kèm độ tin cậy, rồi GỌI proposeResolution. Hoàn tất tất cả các bước.`
        }
      ]
    });
    // The agent writes its resolution to D1 even when the chat stream never signals
    // completion to the client, so poll the detail endpoint directly until the
    // resolution shows up (or we give up). This is what makes the card appear.
    try {
      for (let i = 0; i < 40; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (activeTriageId.current !== id) return; // user switched away / new run
        const res = await fetch(`/api/transactions/${id}`);
        if (!res.ok) continue;
        const data = (await res.json()) as TransactionDetailData;
        if (activeTriageId.current !== id) return;
        if (data.resolutions.length > 0) {
          setDetail(data);
          break;
        }
      }
    } catch (e) {
      console.error("Failed while waiting for AI resolution:", e);
    } finally {
      if (activeTriageId.current === id) setTriaging(false);
      refreshInbox();
    }
  }, [selectedId, triaging, clearHistory, sendMessage, refreshInbox]);

  const decide = useCallback(
    async (
      resolutionId: string,
      decision: "APPROVED" | "REJECTED",
      note?: string
    ) => {
      setDeciding(true);
      try {
        await fetch(`/api/resolutions/${resolutionId}/decide`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision, note })
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
    if (!text || triaging) return;
    setFollowUp("");
    sendMessage({ role: "user", parts: [{ type: "text", text }] });
  }, [followUp, triaging, sendMessage]);

  const txn = detail?.transaction;
  const latestResolution = detail?.resolutions[0];

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b bg-card px-5 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Compass className="size-[18px]" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">PayPilot</h1>
          <span className="hidden text-sm text-muted-foreground sm:inline">
            Hộp xử lý giao dịch lỗi
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "size-2 rounded-full",
                connected ? "dot-green" : "dot-red"
              )}
            />
            <span className="text-xs text-muted-foreground">
              {connected ? "Đã kết nối" : "Mất kết nối"}
            </span>
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={refreshInbox}
            aria-label="Tải lại"
          >
            <RefreshCw />
          </Button>
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={onLogout}>
            <LogOut /> Đăng xuất
          </Button>
        </div>
      </header>

      {/* Two-pane body */}
      <div className="flex min-h-0 flex-1">
        {/* Left: inbox */}
        <aside className="flex w-80 shrink-0 flex-col border-r bg-card">
          <div className="border-b px-4 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Cần xử lý ({inbox.length})
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <InboxList
              items={inbox}
              selectedId={selectedId}
              onSelect={select}
            />
          </div>
        </aside>

        {/* Right: detail */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          {!txn ? (
            <div className="flex h-full items-center justify-center p-6 text-center">
              <p className="max-w-xs text-sm text-muted-foreground">
                Chọn một giao dịch ở bên trái để xem chi tiết và xử lý.
              </p>
            </div>
          ) : (
            <div className="mx-auto max-w-2xl space-y-5 px-6 py-6">
              <TransactionDetail txn={txn} />

              {latestResolution ? (
                <ResolutionCard
                  key={latestResolution.id}
                  resolution={latestResolution}
                  onDecide={decide}
                  deciding={deciding}
                />
              ) : (
                <div className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-card">
                  <p className="text-sm text-muted-foreground">
                    Chưa có đề xuất. Để AI phân tích và đề xuất hướng xử lý.
                  </p>
                  <Button
                    onClick={processWithAI}
                    disabled={triaging || !connected}
                    className="shrink-0"
                  >
                    <Sparkles /> Xử lý bằng AI
                  </Button>
                </div>
              )}

              <AgentActivity
                messages={messages}
                isStreaming={triaging}
                onStop={stop}
                followUp={followUp}
                onFollowUpChange={setFollowUp}
                onSend={sendFollowUp}
                connected={connected}
              />

              {/* Warn if the AI stopped without proposing (e.g. a duplicate pending) */}
              {!latestResolution && !triaging && messages.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-[var(--t-amber-fg)]">
                  <TriangleAlert className="size-3.5" />
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

type AuthState = "checking" | "authed" | "guest";

export default function App() {
  const [authState, setAuthState] = useState<AuthState>("checking");

  useEffect(() => {
    let cancelled = false;
    const loadMe = async () => {
      try {
        const res = await fetch("/api/me");
        if (!cancelled) setAuthState(res.ok ? "authed" : "guest");
      } catch (e) {
        console.error("Failed to check auth:", e);
        if (!cancelled) setAuthState("guest");
      }
    };
    loadMe();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAuthed = useCallback(() => {
    setAuthState("authed");
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch (e) {
      console.error("Failed to log out:", e);
    } finally {
      setAuthState("guest");
    }
  }, []);

  if (authState === "checking") {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        Đang tải…
      </div>
    );
  }

  if (authState === "guest") {
    return <LoginScreen onAuthed={handleAuthed} />;
  }

  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center text-muted-foreground">
          Đang tải…
        </div>
      }
    >
      <PayPilot onLogout={handleLogout} />
    </Suspense>
  );
}
