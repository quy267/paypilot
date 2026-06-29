import type { ResolutionRow, TransactionRow } from "@/services/triage";

/** Minor-unit integer → Vietnamese amount, e.g. 52000000 → "52.000.000 ₫". */
export function vnd(minor: number, currency = "VND"): string {
  const grouped = Math.round(minor)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return currency === "VND" ? `${grouped} ₫` : `${grouped} ${currency}`;
}

export type Tone = "amber" | "red" | "blue" | "green" | "neutral";

// Vietnamese labels for the DB enums (the operator team reads Vietnamese).
export const STATUS_LABEL: Record<TransactionRow["status"], string> = {
  FAILED: "Lỗi",
  FLAGGED: "Nghi ngờ",
  PENDING: "Đang chờ",
  SUCCESS: "Thành công",
};
export const ACTION_LABEL: Record<
  NonNullable<ResolutionRow["proposed_action"]>,
  string
> = {
  RETRY: "Thử lại",
  ESCALATE: "Chuyển cấp trên",
  REFUND: "Hoàn tiền",
};
export const DECISION_LABEL: Record<ResolutionRow["operator_decision"], string> =
  {
    PENDING: "Chờ duyệt",
    APPROVED: "Đã duyệt",
    REJECTED: "Từ chối",
  };

/** Transaction status → colour tone (amber=flagged, red=failed, blue=pending, green=success). */
export function statusTone(status: string): Tone {
  switch (status) {
    case "FLAGGED":
      return "amber";
    case "FAILED":
      return "red";
    case "PENDING":
      return "blue";
    case "SUCCESS":
      return "green";
    default:
      return "neutral";
  }
}

/** Operator decision → colour tone for the resolution badge. */
export function decisionTone(decision: string): Tone {
  switch (decision) {
    case "APPROVED":
      return "green";
    case "REJECTED":
      return "red";
    default:
      return "amber"; // PENDING = awaiting review
  }
}
