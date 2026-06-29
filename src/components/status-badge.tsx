import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/format";

/**
 * Small status pill coloured by tone token (.tone-* / .dot-* in styles.css,
 * which auto-switch light/dark). Used for transaction status and AI decision.
 */
export function StatusBadge({
  tone,
  children,
  dot = false,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        `tone-${tone}`,
        className
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full", `dot-${tone}`)} />}
      {children}
    </span>
  );
}
