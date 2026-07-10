import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { TransactionRow } from "@/services/triage";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/status-badge";
import { STATUS_LABEL, statusTone, vnd } from "@/lib/format";

function DetailRow({
  label,
  value,
  mono = false
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-right font-medium text-foreground",
          mono && "font-mono"
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** Right-pane card: transaction summary + evidence. Nullable rows are hidden (PENDING has no failure fields). */
export function TransactionDetail({ txn }: { txn: TransactionRow }) {
  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-card">
      <div className="p-5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-foreground">{txn.id}</span>
          <StatusBadge tone={statusTone(txn.status)} dot>
            {STATUS_LABEL[txn.status]}
          </StatusBadge>
        </div>
        <div className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">
          {vnd(txn.amount_minor, txn.currency)}
        </div>
      </div>
      <Separator />
      <div className="divide-y divide-border px-5">
        <DetailRow label="Cửa hàng" value={txn.merchant_id} mono />
        <DetailRow label="Phương thức" value={txn.method} />
        {txn.failure_code && (
          <DetailRow label="Mã lỗi" value={txn.failure_code} mono />
        )}
        {txn.failure_reason && (
          <DetailRow label="Lý do" value={txn.failure_reason} />
        )}
        {txn.gateway_ref && (
          <DetailRow label="Mã cổng" value={txn.gateway_ref} mono />
        )}
      </div>
    </div>
  );
}
