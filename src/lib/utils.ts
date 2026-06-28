import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * cn = "class names". Merge conditional Tailwind classes and resolve conflicts:
 * clsx builds the string (dropping falsy values), then twMerge dedupes
 * conflicting utilities so the last one wins — e.g. cn("px-2", "px-4") -> "px-4".
 * Every shadcn/ui component relies on this helper.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
