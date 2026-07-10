import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { STATUS_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TransactionRow } from "@/services/triage";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";

interface AddTransactionFormProps {
  open: boolean;
  onClose: () => void;
  onCreated: (transaction: TransactionRow) => void;
}

interface FormValues {
  merchantId: string;
  amountMinor: string;
  currency: string;
  method: TransactionRow["method"];
  status: TransactionRow["status"];
  failureCode: string;
  failureReason: string;
  gatewayRef: string;
}

const INITIAL_VALUES: FormValues = {
  merchantId: "",
  amountMinor: "",
  currency: "VND",
  method: "QR",
  status: "FAILED",
  failureCode: "",
  failureReason: "",
  gatewayRef: ""
};

const METHODS: TransactionRow["method"][] = ["QR", "CARD", "SOFTPOS"];
const STATUSES: TransactionRow["status"][] = [
  "FAILED",
  "FLAGGED",
  "PENDING",
  "SUCCESS"
];
const FOCUSABLE_SELECTOR = [
  "a[href]",
  'button:not([disabled]):not([tabindex="-1"])',
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])'
].join(",");

const nativeFieldClassName = cn(
  "w-full min-w-0 rounded-md border border-input bg-background text-sm text-foreground shadow-xs outline-none transition-[color,box-shadow]",
  "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
  "aria-invalid:border-destructive aria-invalid:ring-destructive/20 disabled:cursor-not-allowed disabled:opacity-50"
);
const inputClassName = cn(nativeFieldClassName, "h-9 px-3");
const textareaClassName = cn(
  nativeFieldClassName,
  "min-h-24 resize-y px-3 py-2"
);

function apiErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const error = (value as { error?: unknown }).error;
  return typeof error === "string" ? error : null;
}

export function AddTransactionForm({
  open,
  onClose,
  onCreated
}: AddTransactionFormProps) {
  const [values, setValues] = useState<FormValues>(INITIAL_VALUES);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const merchantRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const submittingRef = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();

  const close = useCallback(() => {
    requestControllerRef.current?.abort();
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      requestControllerRef.current?.abort();
      return;
    }
    setValues(INITIAL_VALUES);
    submittingRef.current = false;
    setSubmitting(false);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    const appRoot = document.getElementById("root");
    const appRootWasInert = appRoot?.hasAttribute("inert") ?? false;
    if (!dialog.open) dialog.showModal();
    document.body.style.overflow = "hidden";
    appRoot?.setAttribute("inert", "");

    const focusFrame = window.requestAnimationFrame(() => {
      titleRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      if (!activeElement || !focusable.includes(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (!appRootWasInert) appRoot?.removeAttribute("inert");
      if (dialog.open) dialog.close();
      previousFocusRef.current?.focus();
    };
  }, [close, open]);

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (submittingRef.current) return;

      const merchantId = values.merchantId.trim();
      const currency = values.currency.trim();
      const amountMinor = Number(values.amountMinor);
      if (!merchantId) {
        setError("Merchant không được để trống");
        merchantRef.current?.focus();
        return;
      }
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
        setError("Số tiền phải là số nguyên lớn hơn 0");
        return;
      }
      if (!currency) {
        setError("Tiền tệ không được để trống");
        return;
      }

      const optional = (value: string) => value.trim() || undefined;
      const controller = new AbortController();
      requestControllerRef.current = controller;
      submittingRef.current = true;
      setSubmitting(true);
      setError(null);

      try {
        const response = await fetch("/api/transactions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            merchant_id: merchantId,
            amount_minor: amountMinor,
            currency,
            method: values.method,
            status: values.status,
            gateway_ref: optional(values.gatewayRef),
            failure_code: optional(values.failureCode),
            failure_reason: optional(values.failureReason)
          }),
          signal: controller.signal
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          setError(
            apiErrorMessage(data) ??
              `Không thể thêm giao dịch (mã lỗi ${response.status})`
          );
          return;
        }

        const transaction =
          data && typeof data === "object"
            ? (data as { transaction?: unknown }).transaction
            : undefined;
        if (!transaction || typeof transaction !== "object") {
          setError("Phản hồi tạo giao dịch không hợp lệ");
          return;
        }

        requestControllerRef.current = null;
        submittingRef.current = false;
        onCreated(transaction as TransactionRow);
      } catch (submitError) {
        if (!controller.signal.aborted) {
          console.error("Failed to create transaction:", submitError);
          setError("Không thể kết nối để thêm giao dịch");
        }
      } finally {
        if (requestControllerRef.current === controller) {
          requestControllerRef.current = null;
          submittingRef.current = false;
          setSubmitting(false);
        }
      }
    },
    [onCreated, values]
  );

  if (!open) return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={error ? `${descriptionId} ${errorId}` : descriptionId}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-4 text-inherit outline-none backdrop:bg-transparent open:grid open:place-items-center"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <button
        type="button"
        aria-label="Đóng"
        tabIndex={-1}
        className="absolute inset-0 cursor-default bg-foreground/50"
        onMouseDown={close}
      />
      <Card className="relative z-10 max-h-[calc(100dvh-2rem)] w-full max-w-2xl gap-0 overflow-y-auto overscroll-contain py-0 shadow-xl">
        <form className="contents" onSubmit={submit} aria-busy={submitting}>
          <CardHeader className="border-b px-5 py-4 [.border-b]:pb-4">
            <CardTitle>
              <h2 ref={titleRef} id={titleId} tabIndex={-1}>
                Thêm giao dịch
              </h2>
            </CardTitle>
            <CardDescription id={descriptionId}>
              Nhập giao dịch mới để đưa vào hộp xử lý.
            </CardDescription>
            <CardAction>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Đóng"
                onClick={close}
              >
                <X aria-hidden="true" />
              </Button>
            </CardAction>
          </CardHeader>

          <CardContent className="space-y-4 px-5 py-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="txn-merchant">
                Merchant
              </label>
              <input
                ref={merchantRef}
                id="txn-merchant"
                name="merchant_id"
                aria-label="Merchant"
                value={values.merchantId}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    merchantId: event.target.value
                  }))
                }
                className={inputClassName}
                maxLength={64}
                required
                autoComplete="off"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="txn-amount">
                  Số tiền
                </label>
                <input
                  id="txn-amount"
                  name="amount_minor"
                  aria-label="Số tiền"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  value={values.amountMinor}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      amountMinor: event.target.value
                    }))
                  }
                  className={inputClassName}
                  aria-describedby="txn-amount-hint"
                  required
                />
                <p
                  id="txn-amount-hint"
                  className="text-xs text-muted-foreground"
                >
                  Nhập theo đơn vị nhỏ nhất, là đồng với VND.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="txn-currency">
                  Tiền tệ
                </label>
                <input
                  id="txn-currency"
                  name="currency"
                  aria-label="Tiền tệ"
                  value={values.currency}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      currency: event.target.value
                    }))
                  }
                  className={inputClassName}
                  maxLength={8}
                  required
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="txn-method">
                  Phương thức
                </label>
                <select
                  id="txn-method"
                  name="method"
                  aria-label="Phương thức"
                  value={values.method}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      method: event.target.value as TransactionRow["method"]
                    }))
                  }
                  className={inputClassName}
                  required
                >
                  {METHODS.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="txn-status">
                  Trạng thái
                </label>
                <select
                  id="txn-status"
                  name="status"
                  aria-label="Trạng thái"
                  value={values.status}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      status: event.target.value as TransactionRow["status"]
                    }))
                  }
                  className={inputClassName}
                  required
                >
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABEL[status]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium"
                  htmlFor="txn-failure-code"
                >
                  Mã lỗi{" "}
                  <span className="text-muted-foreground">(tùy chọn)</span>
                </label>
                <input
                  id="txn-failure-code"
                  name="failure_code"
                  aria-label="Mã lỗi"
                  value={values.failureCode}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      failureCode: event.target.value
                    }))
                  }
                  className={inputClassName}
                  maxLength={255}
                  autoComplete="off"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium"
                  htmlFor="txn-gateway-ref"
                >
                  Mã cổng{" "}
                  <span className="text-muted-foreground">(tùy chọn)</span>
                </label>
                <input
                  id="txn-gateway-ref"
                  name="gateway_ref"
                  aria-label="Mã cổng"
                  value={values.gatewayRef}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      gatewayRef: event.target.value
                    }))
                  }
                  className={inputClassName}
                  maxLength={255}
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="txn-reason">
                Lý do lỗi{" "}
                <span className="text-muted-foreground">(tùy chọn)</span>
              </label>
              <textarea
                id="txn-reason"
                name="failure_reason"
                aria-label="Lý do lỗi"
                value={values.failureReason}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    failureReason: event.target.value
                  }))
                }
                className={textareaClassName}
                maxLength={255}
              />
            </div>

            {error && (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </CardContent>

          <CardFooter className="flex-col-reverse justify-end gap-2 border-t px-5 py-4 sm:flex-row [.border-t]:pt-4">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={close}
            >
              Hủy
            </Button>
            <Button
              type="submit"
              className="w-full sm:w-auto"
              disabled={submitting}
            >
              {submitting ? "Đang thêm…" : "Thêm giao dịch"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </dialog>,
    document.body
  );
}
