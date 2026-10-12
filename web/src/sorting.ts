// How sorting stands (docs/design.md, "The sorting line"). An ask behind
// the rules, not sorted yet or sorted with rules saved before, carries the
// time it turns from sorting to stopped (ADR 22). Nothing is written when
// that time passes, so the page works out which it is from the time, as it
// does with a hashtag's hours. The list carries when the daily cap on model
// calls resets while it is spent, and the page drops the cap by the clock
// in the same way.
import type { PageAsk } from "../../shared/page-api";

export interface SortingState {
  // Asks still being sorted with the rules in force.
  sorting: number;
  // Asks whose sorting stopped, which a save of the rules sorts again.
  stopped: number;
}

// How many asks are being sorted at a moment, and how many stopped. An ask
// with no time is sorted with the rules in force, and counts as neither.
export function sortingState(
  asks: readonly Pick<PageAsk, "sortingUntil">[],
  at: number,
): SortingState {
  let sorting = 0;
  let stopped = 0;
  for (const { sortingUntil } of asks) {
    if (sortingUntil === undefined) continue;
    if (at < Date.parse(sortingUntil)) sorting += 1;
    else stopped += 1;
  }
  return { sorting, stopped };
}

// While the daily cap on model calls is spent at a moment, when it resets.
// Null once that time has come, or when the list gives none.
export function capSpentUntil(
  resetsAt: string | undefined,
  at: number,
): number | null {
  if (resetsAt === undefined) return null;
  const until = Date.parse(resetsAt);
  return at < until ? until : null;
}

const asks = (count: number) => `${String(count)} ask${count === 1 ? "" : "s"}`;

// The one line that says how sorting stands: the daily limit, while it is
// reached, with the time it resets on the clock, then asks being sorted,
// then asks that stopped. With none of them, there is no line.
export function sortingLine(
  { sorting, stopped }: SortingState,
  resetsAt: string | null = null,
): string | null {
  if (resetsAt !== null) {
    return `Today's sorting limit is reached. It resets at ${resetsAt}.`;
  }
  if (sorting > 0) return `Sorting ${asks(sorting)} with your rules`;
  if (stopped > 0) {
    return `${asks(stopped)} couldn't be sorted. Saving your rules tries again.`;
  }
  return null;
}
