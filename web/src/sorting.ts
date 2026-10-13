// How sorting stands (docs/design.md, "The sorting line"). An ask behind
// the rules, not sorted yet or sorted with rules saved before, carries the
// time it turns from sorting to stopped (ADR 22). Nothing is written when
// that time passes, so the page works out which it is from the time, as it
// does with a hashtag's hours, but by the service's clock, which gave the
// time. The list carries when the daily cap on model calls resets while it
// is spent, and the page drops the cap in the same way, by the service's
// clock, which counts the cap.
import type { PageAsk } from "../../shared/page-api";

export interface SortingState {
  // Asks still being sorted with the rules in force.
  sorting: number;
  // Asks whose sorting stopped, which a save of the rules sorts again.
  stopped: number;
}

// How many asks are being sorted at a moment on this browser's clock, and
// how many stopped. An ask with no time is sorted with the rules in force,
// and counts as neither. The service gives each time by its own clock,
// serviceAhead ahead of this one (load.ts), and an ask stops when that
// clock reaches its time.
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

// While the daily cap on model calls is spent at a moment on this browser's
// clock, when it resets. Null once that time has come, or when the list
// gives none. The service counts the cap by its own clock, serviceAhead
// ahead of this one (load.ts), and the cap resets when that clock reaches
// the time.
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

// The one line that says how sorting stands: the daily limit, while it is
// reached, with the time it resets on the clock, then asks being sorted,
// then asks that stopped. With none of them, there is no line.
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
