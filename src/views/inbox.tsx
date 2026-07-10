import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import type { TriageAgent } from "../server";
import type { ResolutionRow, TransactionRow } from "@/services/triage";
import type { ScoredTransaction } from "@/services/priority";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  InboxControls,
  type InboxOrder,
  type InboxSort,
  type InboxStatusFilter
} from "@/components/inbox-controls";
import { InboxList } from "@/components/inbox-list";
import { TransactionDetail } from "@/components/transaction-detail";
import { ResolutionCard } from "@/components/resolution-card";
import { AgentActivity } from "@/components/agent-activity";
import { AddTransactionForm } from "@/components/add-transaction-form";

interface TransactionDetailData {
  transaction: TransactionRow;
  evidence: Record<string, unknown>;
  resolutions: ResolutionRow[];
}

interface InboxResponse {
  transactions: ScoredTransaction[];
  total: number;
  limit: number;
  offset: number;
}

function isInboxResponse(value: unknown): value is InboxResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<InboxResponse>;
  return (
    Array.isArray(candidate.transactions) &&
    Number.isInteger(candidate.total) &&
    Number.isInteger(candidate.limit) &&
    Number.isInteger(candidate.offset)
  );
}

const INBOX_PAGE_LIMIT = 25;

export function InboxView() {
  const [connected, setConnected] = useState(false);
  const [inbox, setInbox] = useState<ScoredTransaction[]>([]);
  const [inboxPage, setInboxPage] = useState({
    total: 0,
    limit: INBOX_PAGE_LIMIT,
    offset: 0
  });
  const [inboxLoading, setInboxLoading] = useState(true);
  const [inboxError, setInboxError] = useState(false);
  const [statusFilter, setStatusFilter] = useState<InboxStatusFilter>("");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [inboxSort, setInboxSort] = useState<InboxSort>("score");
  const [inboxOrder, setInboxOrder] = useState<InboxOrder>("desc");
  const [inboxOffset, setInboxOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TransactionDetailData | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [followUp, setFollowUp] = useState("");
  const [addTransactionOpen, setAddTransactionOpen] = useState(false);
  const wasStreaming = useRef(false);
  // Prevent a slower request for stale controls from replacing the current page.
  const latestInboxReq = useRef(0);
  const displayedInboxQuery = useRef<string | null>(null);
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
    const requestId = ++latestInboxReq.current;
    const params = new URLSearchParams({
      sort: inboxSort,
      order: inboxOrder,
      limit: String(INBOX_PAGE_LIMIT),
      offset: String(inboxOffset)
    });
    if (statusFilter) params.set("status", statusFilter);
    if (debouncedQuery) params.set("q", debouncedQuery);
    const queryString = params.toString();
    const queryChanged = displayedInboxQuery.current !== queryString;

    // Do not leave rows from the previous controls actionable under a new filter
    // while its request is pending or after that request fails.
    if (queryChanged) {
      displayedInboxQuery.current = null;
      setInbox([]);
      setInboxPage({
        total: 0,
        limit: INBOX_PAGE_LIMIT,
        offset: inboxOffset
      });
      setInboxLoading(true);
      setInboxError(false);
    }

    try {
      const res = await fetch(`/api/inbox?${queryString}`);
      if (!res.ok) throw new Error(`Inbox request failed (${res.status})`);
      const data: unknown = await res.json();
      if (!isInboxResponse(data)) {
        throw new Error("Inbox response has an invalid shape");
      }
      if (latestInboxReq.current !== requestId) return;
      displayedInboxQuery.current = queryString;
      setInboxLoading(false);
      setInboxError(false);
      setInbox(data.transactions);
      setInboxPage({
        total: data.total,
        limit: data.limit,
        offset: data.offset
      });
    } catch (e) {
      if (latestInboxReq.current === requestId) {
        console.error("Failed to load inbox:", e);
        setInboxLoading(false);
        if (queryChanged) {
          setInboxError(true);
        }
      }
    }
  }, [statusFilter, debouncedQuery, inboxSort, inboxOrder, inboxOffset]);
  // Async triage/decision work can outlive the controls captured when it began.
  // Always refresh through the newest query callback when that work completes.
  const latestRefreshInbox = useRef(refreshInbox);
  // Keep the ref in sync after commit (not during render) so background refreshes
  // always call the newest query callback without breaking React's render purity.
  useLayoutEffect(() => {
    latestRefreshInbox.current = refreshInbox;
  });

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

  useEffect(
    () => () => {
      activeTriageId.current = null;
    },
    []
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setInboxOffset(0);
      setDebouncedQuery(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

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

  const changeStatusFilter = useCallback((status: InboxStatusFilter) => {
    setStatusFilter(status);
    setInboxOffset(0);
  }, []);

  const changeInboxSort = useCallback((sort: InboxSort) => {
    setInboxSort(sort);
    setInboxOffset(0);
  }, []);

  const toggleInboxOrder = useCallback(() => {
    setInboxOrder((current) => (current === "desc" ? "asc" : "desc"));
    setInboxOffset(0);
  }, []);

  const showPreviousPage = useCallback(() => {
    setInboxOffset(Math.max(0, inboxPage.offset - inboxPage.limit));
  }, [inboxPage.limit, inboxPage.offset]);

  const showNextPage = useCallback(() => {
    setInboxOffset(inboxPage.offset + inboxPage.limit);
  }, [inboxPage.limit, inboxPage.offset]);

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
      latestRefreshInbox.current();
    }
  }, [selectedId, triaging, clearHistory, sendMessage]);

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
        await latestRefreshInbox.current();
      } catch (e) {
        console.error("Failed to record decision:", e);
      } finally {
        setDeciding(false);
      }
    },
    [selectedId, refreshDetail]
  );

  const sendFollowUp = useCallback(() => {
    const text = followUp.trim();
    if (!text || triaging) return;
    setFollowUp("");
    sendMessage({ role: "user", parts: [{ type: "text", text }] });
  }, [followUp, triaging, sendMessage]);

  const openAddTransaction = useCallback(() => {
    setAddTransactionOpen(true);
  }, []);

  const closeAddTransaction = useCallback(() => {
    setAddTransactionOpen(false);
  }, []);

  const transactionCreated = useCallback(() => {
    setAddTransactionOpen(false);
    void refreshInbox();
  }, [refreshInbox]);

  const txn = detail?.transaction;
  const latestResolution = detail?.resolutions[0];

  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      {/* Left: inbox */}
      <aside className="flex w-80 shrink-0 flex-col border-r bg-card">
        <div className="border-b px-4 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Cần xử lý ({inboxPage.total})
            </div>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={openAddTransaction}
              aria-haspopup="dialog"
              aria-expanded={addTransactionOpen}
            >
              Thêm giao dịch
            </Button>
          </div>
          <div className="mt-1 flex items-center justify-end gap-1">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className={cn(
                  "size-2 rounded-full",
                  connected ? "dot-green" : "dot-red"
                )}
              />
              {connected ? "Đã kết nối" : "Mất kết nối"}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={refreshInbox}
              aria-label="Tải lại"
            >
              <RefreshCw />
            </Button>
          </div>
        </div>
        <InboxControls
          status={statusFilter}
          query={searchInput}
          sort={inboxSort}
          order={inboxOrder}
          total={inboxPage.total}
          limit={inboxPage.limit}
          offset={inboxPage.offset}
          itemCount={inbox.length}
          onStatusChange={changeStatusFilter}
          onQueryChange={setSearchInput}
          onSortChange={changeInboxSort}
          onOrderToggle={toggleInboxOrder}
          onPrevious={showPreviousPage}
          onNext={showNextPage}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {inboxLoading ? (
            <output className="p-6 text-center text-sm text-muted-foreground">
              Đang tải hộp xử lý…
            </output>
          ) : inboxError ? (
            <div
              role="alert"
              className="space-y-3 p-6 text-center text-sm text-muted-foreground"
            >
              <p>Không thể tải hộp xử lý.</p>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={refreshInbox}
              >
                Thử lại
              </Button>
            </div>
          ) : (
            <InboxList
              items={inbox}
              selectedId={selectedId}
              onSelect={select}
            />
          )}
        </div>
      </aside>

      {/* Right: detail */}
      <section
        aria-label="Chi tiết giao dịch"
        className="min-w-0 flex-1 overflow-y-auto"
      >
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
      </section>

      <AddTransactionForm
        open={addTransactionOpen}
        onClose={closeAddTransaction}
        onCreated={transactionCreated}
      />
    </div>
  );
}
