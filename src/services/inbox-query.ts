import { z } from "zod";
import { RISK_BY_STATUS, type ScoredTransaction } from "./priority";

const integerQueryParam = z.string().regex(/^\d+$/).transform(Number);

export const inboxQuerySchema = z
  .object({
    status: z.enum(["FAILED", "FLAGGED", "PENDING"]).optional(),
    q: z
      .string()
      .trim()
      .max(100)
      .transform((value) => value || undefined)
      .optional(),
    sort: z.enum(["score", "amount", "age", "status"]).optional(),
    order: z.enum(["asc", "desc"]).optional(),
    limit: integerQueryParam.pipe(z.number().int().min(1).max(100)).optional(),
    offset: integerQueryParam.pipe(z.number().int().min(0)).optional()
  })
  .transform((query) => ({
    ...query,
    sort: query.sort ?? "score",
    order: query.order ?? "desc",
    limit: query.limit ?? 25,
    offset: query.offset ?? 0
  }));

export type InboxSort = "score" | "amount" | "age" | "status";
export type InboxOrder = "asc" | "desc";

/** Re-sort scored candidates while retaining Phase 1 priority order for equal keys. */
export function sortScoredInbox(
  scored: ScoredTransaction[],
  sort: InboxSort,
  order: InboxOrder
): ScoredTransaction[] {
  if (sort === "score" && order === "desc") return scored;

  const priorityPosition = new Map(
    scored.map((transaction, index) => [transaction.id, index])
  );
  const direction = order === "asc" ? 1 : -1;
  scored.sort((a, b) => {
    let comparison: number;
    switch (sort) {
      case "amount":
        comparison = a.amount_minor - b.amount_minor;
        break;
      case "age":
        // For this API, descending age order is explicitly newest first.
        comparison = a.created_at - b.created_at;
        break;
      case "status":
        comparison =
          (RISK_BY_STATUS[a.status as keyof typeof RISK_BY_STATUS] ?? 0) -
          (RISK_BY_STATUS[b.status as keyof typeof RISK_BY_STATUS] ?? 0);
        break;
      case "score":
        comparison = a.score - b.score;
        break;
    }
    if (comparison !== 0) return comparison * direction;
    return (
      (priorityPosition.get(a.id) ?? 0) - (priorityPosition.get(b.id) ?? 0)
    );
  });
  return scored;
}
