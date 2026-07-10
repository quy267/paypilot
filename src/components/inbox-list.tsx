import { cn } from "@/lib/utils";
import type { TransactionRow } from "@/services/triage";
import { StatusBadge } from "@/components/status-badge";
import { STATUS_LABEL, statusTone, vnd } from "@/lib/format";

/** Left-pane list of open transactions (already prioritized by the API). */
export function InboxList({
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
      <div className="p-6 text-center text-sm text-muted-foreground">
        Hộp xử lý trống.
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border">
      {items.map((t) => {
        const active = t.id === selectedId;
        const tone = statusTone(t.status);
        return (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onSelect(t.id)}
              aria-current={active ? "true" : undefined}
              className={cn(
                "w-full cursor-pointer border-l-2 px-4 py-3 text-left transition-colors",
                active
                  ? "border-l-primary bg-accent"
                  : "border-l-transparent hover:bg-muted"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      `dot-${tone}`
                    )}
                  />
                  <span className="truncate font-mono text-sm font-medium">
                    {t.id}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {vnd(t.amount_minor, t.currency)}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <StatusBadge tone={tone}>{STATUS_LABEL[t.status]}</StatusBadge>
                <span className="text-xs font-medium text-muted-foreground">
                  {t.method}
                </span>
              </div>
              {t.failure_reason && (
                <div className="mt-1.5 truncate text-xs text-muted-foreground">
                  {t.failure_reason}
                </div>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
