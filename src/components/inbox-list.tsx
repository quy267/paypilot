import { cn } from "@/lib/utils";
import type { ScoredTransaction } from "@/services/priority";
import { StatusBadge } from "@/components/status-badge";
import { STATUS_LABEL, statusTone, vnd } from "@/lib/format";

const PRIORITY_FACTORS = [
  {
    key: "impact",
    label: "Tác động",
    color: "bg-[var(--t-blue-fg)]"
  },
  {
    key: "urgency",
    label: "Khẩn cấp",
    color: "bg-[var(--t-amber-fg)]"
  },
  { key: "risk", label: "Rủi ro", color: "bg-[var(--t-red-fg)]" }
] as const;

/** Left-pane list of open transactions (already prioritized by the API). */
export function InboxList({
  items,
  selectedId,
  onSelect
}: {
  items: ScoredTransaction[];
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
        const priorityPercent = Math.round(t.score * 100);
        const priorityFactors = PRIORITY_FACTORS.map((factor) => ({
          ...factor,
          percent: Math.round(t.breakdown[factor.key] * 100)
        }));
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
              <div className="mt-2 flex min-w-0 items-center gap-2">
                <StatusBadge tone={tone} className="shrink-0 whitespace-nowrap">
                  {STATUS_LABEL[t.status]}
                </StatusBadge>
                <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
                  {t.method}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-1.5">
                  <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-foreground">
                    Ưu tiên {priorityPercent}%
                  </span>
                  <span className="flex gap-1" aria-hidden="true">
                    {priorityFactors.map((factor) => (
                      <span
                        key={factor.key}
                        title={`${factor.label}: ${factor.percent}%`}
                        className="h-1.5 w-5 overflow-hidden rounded-full bg-muted"
                      >
                        <span
                          className={cn(
                            "block h-full rounded-full",
                            factor.color
                          )}
                          style={{ width: `${factor.percent}%` }}
                        />
                      </span>
                    ))}
                  </span>
                  <span className="sr-only">
                    {priorityFactors
                      .map((factor) => `${factor.label} ${factor.percent}%`)
                      .join(", ")}
                  </span>
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
