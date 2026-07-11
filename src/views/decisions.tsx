import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ACTION_LABEL,
  DECISION_LABEL,
  formatEpochSeconds,
  vnd
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DecisionRow } from "@/services/triage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";

const DECISIONS_PAGE_LIMIT = 25;

type DecisionFilter = "" | DecisionRow["operator_decision"];

interface DecisionsResponse {
  decisions: DecisionRow[];
  total: number;
  limit: number;
  offset: number;
}

function isDecisionsResponse(value: unknown): value is DecisionsResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DecisionsResponse>;
  return (
    Array.isArray(candidate.decisions) &&
    Number.isInteger(candidate.total) &&
    Number.isInteger(candidate.limit) &&
    Number.isInteger(candidate.offset)
  );
}

const fieldClassName = cn(
  "h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none transition-[color,box-shadow]",
  "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
);

const decisionToneClassName: Record<DecisionRow["operator_decision"], string> =
  {
    APPROVED: "tone-green",
    REJECTED: "tone-red",
    PENDING: "tone-amber"
  };

function formatConfidence(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

export function DecisionsView() {
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [page, setPage] = useState({
    total: 0,
    limit: DECISIONS_PAGE_LIMIT,
    offset: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>("");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [retryToken, setRetryToken] = useState(0);
  const latestRequestId = useRef(0);

  const loadDecisions = useCallback(
    async (signal: AbortSignal, requestId: number) => {
      const params = new URLSearchParams({
        limit: String(DECISIONS_PAGE_LIMIT),
        offset: String(offset)
      });
      if (decisionFilter) params.set("decision", decisionFilter);
      if (debouncedQuery) params.set("q", debouncedQuery);

      setLoading(true);
      setError(false);
      setDecisions([]);
      setPage({
        total: 0,
        limit: DECISIONS_PAGE_LIMIT,
        offset
      });

      try {
        const response = await fetch(`/api/decisions?${params.toString()}`, {
          signal
        });
        if (!response.ok) {
          throw new Error(`Decisions request failed (${response.status})`);
        }
        const data: unknown = await response.json();
        if (!isDecisionsResponse(data)) {
          throw new Error("Decisions response has an invalid shape");
        }
        if (signal.aborted || latestRequestId.current !== requestId) return;

        setDecisions(data.decisions);
        setPage({
          total: data.total,
          limit: data.limit,
          offset: data.offset
        });
      } catch (loadError) {
        if (signal.aborted || latestRequestId.current !== requestId) return;
        console.error("Failed to load decision history:", loadError);
        setError(true);
      } finally {
        if (!signal.aborted && latestRequestId.current === requestId) {
          setLoading(false);
        }
      }
    },
    [decisionFilter, debouncedQuery, offset]
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setOffset(0);
      setDebouncedQuery(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++latestRequestId.current;
    void loadDecisions(controller.signal, requestId);

    return () => {
      controller.abort();
      if (latestRequestId.current === requestId) {
        latestRequestId.current += 1;
      }
    };
  }, [loadDecisions, retryToken]);

  const exportHref = useMemo(() => {
    const params = new URLSearchParams();
    const exportQuery = debouncedQuery;
    if (decisionFilter) params.set("decision", decisionFilter);
    if (exportQuery) params.set("q", exportQuery);
    const queryString = params.toString();
    return `/api/export/decisions.csv${queryString ? `?${queryString}` : ""}`;
  }, [decisionFilter, debouncedQuery]);

  const changeDecisionFilter = useCallback((decision: DecisionFilter) => {
    setDecisionFilter(decision);
    setOffset(0);
  }, []);

  const showPreviousPage = useCallback(() => {
    setOffset(Math.max(0, page.offset - page.limit));
  }, [page.limit, page.offset]);

  const showNextPage = useCallback(() => {
    setOffset(page.offset + page.limit);
  }, [page.limit, page.offset]);

  const retry = useCallback(() => {
    setRetryToken((current) => current + 1);
  }, []);

  const rangeStart = decisions.length === 0 ? 0 : page.offset + 1;
  const rangeEnd =
    decisions.length === 0
      ? 0
      : Math.min(page.offset + decisions.length, page.total);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
        <Card className="gap-0 overflow-hidden py-0 shadow-card">
          <CardHeader className="gap-4 border-b py-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1.5">
                <CardTitle>Lịch sử quyết định</CardTitle>
                <CardDescription>
                  Tra cứu các đề xuất của AI và quyết định của nhân viên vận
                  hành.
                </CardDescription>
              </div>
              <Button asChild variant="outline" size="sm">
                <a
                  href={exportHref}
                  download
                  aria-label="Xuất lịch sử quyết định dạng CSV"
                >
                  Xuất CSV
                </a>
              </Button>
            </div>

            <section
              aria-label="Bộ lọc lịch sử quyết định"
              className="flex flex-col gap-3 sm:flex-row"
            >
              <div className="sm:w-44">
                <label className="sr-only" htmlFor="decision-filter">
                  Lọc theo quyết định
                </label>
                <select
                  id="decision-filter"
                  aria-label="Lọc theo quyết định"
                  value={decisionFilter}
                  onChange={(event) =>
                    changeDecisionFilter(event.target.value as DecisionFilter)
                  }
                  className={cn(fieldClassName, "w-full")}
                >
                  <option value="">Tất cả</option>
                  <option value="APPROVED">Đã duyệt</option>
                  <option value="REJECTED">Từ chối</option>
                  <option value="PENDING">Chờ</option>
                </select>
              </div>

              <div className="min-w-0 flex-1">
                <label className="sr-only" htmlFor="decision-search">
                  Tìm kiếm lịch sử quyết định
                </label>
                <input
                  id="decision-search"
                  type="search"
                  aria-label="Tìm kiếm lịch sử quyết định"
                  value={searchInput}
                  maxLength={100}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Tìm mã GD, merchant, ghi chú…"
                  className={cn(fieldClassName, "w-full")}
                />
              </div>
            </section>
          </CardHeader>

          <CardContent className="p-0">
            {loading ? (
              <div className="flex min-h-72 items-center justify-center p-6">
                <output
                  className="text-sm text-muted-foreground"
                  aria-live="polite"
                >
                  Đang tải lịch sử quyết định…
                </output>
              </div>
            ) : error ? (
              <div
                role="alert"
                className="flex min-h-72 flex-col items-center justify-center gap-3 p-6 text-center"
              >
                <div className="space-y-1">
                  <p className="font-medium">
                    Không thể tải lịch sử quyết định
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Vui lòng thử lại sau giây lát.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={retry}
                >
                  Thử lại
                </Button>
              </div>
            ) : decisions.length === 0 ? (
              <div className="flex min-h-72 items-center justify-center p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  Chưa có quyết định phù hợp với bộ lọc.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1120px] border-collapse text-sm">
                  <caption className="sr-only">Lịch sử quyết định</caption>
                  <thead className="bg-muted/60 text-left text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Thời điểm
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Mã GD
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Merchant
                      </th>
                      <th
                        scope="col"
                        className="px-4 py-3 text-right font-medium"
                      >
                        Số tiền
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Hành động
                      </th>
                      <th
                        scope="col"
                        className="px-4 py-3 text-right font-medium"
                      >
                        Độ tự tin
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Quyết định
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Ghi chú
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {decisions.map((decision) => (
                      <tr
                        key={decision.resolution_id}
                        className="transition-colors hover:bg-muted/35"
                      >
                        <td className="px-4 py-3 whitespace-nowrap text-muted-foreground tabular-nums">
                          {formatEpochSeconds(
                            decision.decided_at ?? decision.created_at
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs font-medium whitespace-nowrap">
                          {decision.transaction_id}
                        </td>
                        <td className="max-w-48 px-4 py-3 font-medium break-words">
                          {decision.merchant_id}
                        </td>
                        <td className="px-4 py-3 text-right font-medium whitespace-nowrap tabular-nums">
                          {vnd(decision.amount_minor, decision.currency)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {decision.proposed_action
                            ? ACTION_LABEL[decision.proposed_action]
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                          {formatConfidence(decision.confidence)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <Badge
                            variant="outline"
                            className={cn(
                              "font-medium",
                              decisionToneClassName[decision.operator_decision]
                            )}
                          >
                            {DECISION_LABEL[decision.operator_decision]}
                          </Badge>
                        </td>
                        <td className="max-w-72 px-4 py-3 align-top">
                          <div className="break-words">
                            {decision.operator_note ?? "—"}
                          </div>
                          {decision.operator_id && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              Người xử lý: {decision.operator_id}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <nav
              aria-label="Phân trang lịch sử quyết định"
              className="flex items-center justify-between gap-3 border-t px-4 py-3"
            >
              <span
                aria-live="polite"
                className="text-xs text-muted-foreground tabular-nums"
              >
                {rangeStart}–{rangeEnd} / {page.total}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={showPreviousPage}
                  disabled={loading || page.offset === 0}
                >
                  Trước
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={showNextPage}
                  disabled={loading || page.offset + page.limit >= page.total}
                >
                  Sau
                </Button>
              </div>
            </nav>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
