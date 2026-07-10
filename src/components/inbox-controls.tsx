import { ArrowDown, ArrowUp } from "lucide-react";
import { STATUS_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const INBOX_STATUSES = ["FAILED", "FLAGGED", "PENDING"] as const;
const INBOX_SORTS = [
  { value: "score", label: "Ưu tiên" },
  { value: "amount", label: "Số tiền" },
  { value: "age", label: "Tuổi" },
  { value: "status", label: "Trạng thái" }
] as const;

export type InboxStatusFilter = "" | (typeof INBOX_STATUSES)[number];
export type InboxSort = (typeof INBOX_SORTS)[number]["value"];
export type InboxOrder = "asc" | "desc";

interface InboxControlsProps {
  status: InboxStatusFilter;
  query: string;
  sort: InboxSort;
  order: InboxOrder;
  total: number;
  limit: number;
  offset: number;
  itemCount: number;
  onStatusChange: (status: InboxStatusFilter) => void;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: InboxSort) => void;
  onOrderToggle: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

const fieldClassName = cn(
  "h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow]",
  "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
);

export function InboxControls({
  status,
  query,
  sort,
  order,
  total,
  limit,
  offset,
  itemCount,
  onStatusChange,
  onQueryChange,
  onSortChange,
  onOrderToggle,
  onPrevious,
  onNext
}: InboxControlsProps) {
  const rangeStart = itemCount === 0 ? 0 : offset + 1;
  const rangeEnd = itemCount === 0 ? 0 : Math.min(offset + itemCount, total);
  const orderLabel = order === "desc" ? "Giảm dần" : "Tăng dần";

  return (
    <section
      aria-label="Bộ lọc và phân trang hộp xử lý"
      className="space-y-2 border-b p-3"
    >
      <label className="sr-only" htmlFor="inbox-search">
        Tìm kiếm giao dịch
      </label>
      <input
        id="inbox-search"
        type="search"
        aria-label="Tìm kiếm giao dịch"
        value={query}
        maxLength={100}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Tìm mã GD, merchant…"
        className={cn(fieldClassName, "w-full px-3")}
      />

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
        <label className="sr-only" htmlFor="inbox-status">
          Lọc theo trạng thái
        </label>
        <select
          id="inbox-status"
          aria-label="Lọc theo trạng thái"
          value={status}
          onChange={(event) =>
            onStatusChange(event.target.value as InboxStatusFilter)
          }
          className={cn(fieldClassName, "w-full")}
        >
          <option value="">Tất cả</option>
          {INBOX_STATUSES.map((inboxStatus) => (
            <option key={inboxStatus} value={inboxStatus}>
              {STATUS_LABEL[inboxStatus]}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="inbox-sort">
          Sắp xếp theo
        </label>
        <select
          id="inbox-sort"
          aria-label="Sắp xếp theo"
          value={sort}
          onChange={(event) => onSortChange(event.target.value as InboxSort)}
          className={cn(fieldClassName, "w-full")}
        >
          {INBOX_SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={onOrderToggle}
          aria-label={`Thứ tự ${orderLabel.toLowerCase()}`}
          title={orderLabel}
        >
          {order === "desc" ? <ArrowDown /> : <ArrowUp />}
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs tabular-nums text-muted-foreground">
          {rangeStart}–{rangeEnd} / {total}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={onPrevious}
            disabled={offset === 0}
          >
            Trước
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={onNext}
            disabled={offset + limit >= total}
          >
            Sau
          </Button>
        </div>
      </div>
    </section>
  );
}
