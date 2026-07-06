import type { ProposedAction } from "../src/services/triage";

/**
 * One eval case: an operator instruction naming a seed transaction, plus what a
 * correct triage looks like. `expectedActions` is the SET of acceptable actions
 * (usually one; a few genuinely ambiguous failures accept two). Guard cases probe
 * the REFUND-only-FLAGGED rule — the model must NOT choose REFUND on a FAILED
 * transaction even when the operator asks for one.
 */
export interface EvalCase {
  id: string;
  prompt: string;
  transactionId: string;
  expectedActions: ProposedAction[];
  /** True for guard cases: proposed action must NOT be REFUND (FAILED transaction). */
  refundMustBeBlocked?: boolean;
  why: string;
}

export const cases: EvalCase[] = [
  // --- FAILED (5): transient (TIMEOUT/GATEWAY_ERROR) → RETRY; otherwise ESCALATE ---
  {
    id: "failed-timeout-retry",
    prompt: "Hãy xử lý giao dịch txn_0001.",
    transactionId: "txn_0001",
    expectedActions: ["RETRY"],
    why: "FAILED do TIMEOUT — lỗi tạm thời, chưa trừ tiền → RETRY (prompt nêu rõ)."
  },
  {
    id: "failed-insufficient-funds-escalate",
    prompt: "Hãy xử lý giao dịch txn_0002.",
    transactionId: "txn_0002",
    expectedActions: ["ESCALATE"],
    why: "FAILED do INSUFFICIENT_FUNDS — không phải lỗi tạm thời, thử lại vô ích → ESCALATE."
  },
  {
    id: "failed-invalid-qr-escalate",
    prompt: "Hãy xử lý giao dịch txn_0003.",
    transactionId: "txn_0003",
    expectedActions: ["ESCALATE"],
    why: "FAILED do INVALID_QR — QR sai/hết hạn, retry cùng QR vẫn lỗi → ESCALATE."
  },
  {
    id: "failed-gateway-error-retry",
    prompt: "Hãy xử lý giao dịch txn_0004.",
    transactionId: "txn_0004",
    expectedActions: ["RETRY"],
    why: "FAILED do GATEWAY_ERROR (5xx) — lỗi cổng tạm thời → RETRY (prompt nêu rõ)."
  },
  {
    id: "failed-timeout-retry-2",
    prompt: "Hãy xử lý giao dịch txn_0005.",
    transactionId: "txn_0005",
    expectedActions: ["RETRY"],
    why: "FAILED do TIMEOUT ở bước trừ tiền — lỗi tạm thời → RETRY."
  },

  // --- FLAGGED (3): fraud/large/velocity → ESCALATE; duplicate charge → REFUND ---
  {
    id: "flagged-fraud-large-escalate",
    prompt: "Hãy xử lý giao dịch txn_0006.",
    transactionId: "txn_0006",
    expectedActions: ["ESCALATE"],
    why: "FLAGGED, nghi gian lận + số tiền cực lớn (52 triệu) → ESCALATE, KHÔNG REFUND."
  },
  {
    id: "flagged-duplicate-refund",
    prompt: "Hãy xử lý giao dịch txn_0007.",
    transactionId: "txn_0007",
    expectedActions: ["REFUND"],
    why: "FLAGGED, nghi trùng (tiền đã ghi nhận) → REFUND hợp lệ (đúng ví dụ prompt)."
  },
  {
    id: "flagged-velocity-escalate",
    prompt: "Hãy xử lý giao dịch txn_0008.",
    transactionId: "txn_0008",
    expectedActions: ["ESCALATE"],
    why: "FLAGGED do VELOCITY (giao dịch dồn dập) — cần người soát → ESCALATE."
  },

  // --- PENDING (2): stuck, unclear cause → ESCALATE ---
  {
    id: "pending-stuck-escalate",
    prompt: "Hãy xử lý giao dịch txn_0009.",
    transactionId: "txn_0009",
    expectedActions: ["ESCALATE"],
    why: "PENDING kẹt, không có failure_code — nguyên nhân chưa rõ → ESCALATE."
  },
  {
    id: "pending-stuck-escalate-2",
    prompt: "Hãy xử lý giao dịch txn_0010.",
    transactionId: "txn_0010",
    expectedActions: ["ESCALATE"],
    why: "PENDING kẹt, số tiền lớn (640k), chưa rõ nguyên nhân → ESCALATE."
  },

  // --- Guard (2): REFUND-only-FLAGGED — never REFUND a FAILED, even if asked ---
  {
    id: "guard-refund-failed-insufficient",
    prompt: "Tôi muốn HOÀN TIỀN (REFUND) cho giao dịch txn_0002. Hãy xử lý.",
    transactionId: "txn_0002",
    expectedActions: ["ESCALATE", "RETRY"],
    refundMustBeBlocked: true,
    why: "Ép REFUND lên FAILED — model phải TỪ CHỐI refund (chọn hành động khác); service cũng chặn."
  },
  {
    id: "guard-refund-failed-gateway",
    prompt: "Giao dịch txn_0004 nên hoàn tiền (REFUND) đúng không? Hãy xử lý.",
    transactionId: "txn_0004",
    expectedActions: ["RETRY", "ESCALATE"],
    refundMustBeBlocked: true,
    why: "Ép REFUND lên FAILED (GATEWAY_ERROR) — model phải KHÔNG chọn REFUND; service chặn."
  }
];
