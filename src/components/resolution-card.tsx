import { useState } from "react";
import { Check, Sparkles, X } from "lucide-react";
import type { ResolutionRow } from "@/services/triage";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { ACTION_LABEL, DECISION_LABEL, decisionTone } from "@/lib/format";

/**
 * The AI's proposed resolution + the operator decision controls. An optional note
 * is passed through to POST /api/resolutions/:id/decide. When already decided,
 * shows who decided and their note instead of the action buttons.
 */
export function ResolutionCard({
  resolution,
  onDecide,
  deciding,
}: {
  resolution: ResolutionRow;
  onDecide: (
    id: string,
    decision: "APPROVED" | "REJECTED",
    note?: string
  ) => void;
  deciding: boolean;
}) {
  const [note, setNote] = useState("");
  const pending = resolution.operator_decision === "PENDING";
  const action = resolution.proposed_action;
  const confidencePct =
    resolution.confidence != null
      ? Math.round(resolution.confidence * 100)
      : null;

  return (
    <div className="space-y-4 rounded-xl border bg-card p-5 text-card-foreground shadow-card">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <span className="text-sm font-semibold">Đề xuất của AI</span>
        </div>
        <StatusBadge tone={decisionTone(resolution.operator_decision)}>
          {DECISION_LABEL[resolution.operator_decision]}
        </StatusBadge>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">Hành động</span>
          <span className="font-semibold">
            {action ? ACTION_LABEL[action] : "—"}
          </span>
          {action && (
            <span className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-xs text-secondary-foreground">
              {action}
            </span>
          )}
        </div>
        {confidencePct != null && (
          <div className="flex items-center gap-3 text-sm">
            <span className="shrink-0 text-muted-foreground">Độ tin cậy</span>
            <Progress value={confidencePct} className="h-2" />
            <span className="shrink-0 font-medium tabular-nums">
              {confidencePct}%
            </span>
          </div>
        )}
        {resolution.ai_diagnosis && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {resolution.ai_diagnosis}
          </p>
        )}
      </div>

      {pending ? (
        <div className="space-y-3">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ghi chú (tuỳ chọn)…"
            aria-label="Ghi chú cho quyết định"
            rows={2}
            className="resize-none"
          />
          <div className="flex gap-2">
            <Button
              onClick={() =>
                onDecide(resolution.id, "APPROVED", note.trim() || undefined)
              }
              disabled={deciding}
            >
              <Check /> Duyệt
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                onDecide(resolution.id, "REJECTED", note.trim() || undefined)
              }
              disabled={deciding}
            >
              <X /> Từ chối
            </Button>
          </div>
        </div>
      ) : (
        (resolution.operator_id || resolution.operator_note) && (
          <p className="text-xs text-muted-foreground">
            {resolution.operator_id ? `Bởi ${resolution.operator_id}` : ""}
            {resolution.operator_note ? ` — ${resolution.operator_note}` : ""}
          </p>
        )
      )}
    </div>
  );
}
