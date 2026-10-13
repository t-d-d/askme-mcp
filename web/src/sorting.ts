// Nothing is written when an ask's sortingUntil passes (ADR 22), so the page
// tells sorting from stopped by the time, on the service's clock.
import type { PageAsk } from "../../shared/page-api";

export interface SortingState {
  sorting: number;
  stopped: number;
}

// An ask with no sortingUntil is sorted with the rules in force.
export function sortingState(
  asks: readonly Pick<PageAsk, "sortingUntil">[],
  at: number,
  serviceAhead: number,
): SortingState {
  let sorting = 0;
  let stopped = 0;
  for (const { sortingUntil } of asks) {
    if (sortingUntil === undefined) continue;
    if (at + serviceAhead < Date.parse(sortingUntil)) sorting += 1;
    else stopped += 1;
  }
  return { sorting, stopped };
}

export function capSpentUntil(
  resetsAt: string | undefined,
  at: number,
  serviceAhead: number,
): number | null {
  if (resetsAt === undefined) return null;
  const until = Date.parse(resetsAt);
  return at + serviceAhead < until ? until : null;
}

const asks = (count: number) => `${String(count)} ask${count === 1 ? "" : "s"}`;

export function sortingLine(
  { sorting, stopped }: SortingState,
  resetTime: string | null = null,
): string | null {
  if (resetTime !== null) {
    return `Today's sorting limit is reached. It resets at ${resetTime}.`;
  }
  if (sorting > 0) return `Sorting ${asks(sorting)} with your rules`;
  if (stopped > 0) {
    return `${asks(stopped)} couldn't be sorted. Saving your rules tries again.`;
  }
  return null;
}
