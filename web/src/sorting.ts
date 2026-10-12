// How sorting stands (docs/design.md, "The sorting line"). An ask behind
// the rules, not sorted yet or sorted with rules saved before, carries the
// time it turns from sorting to stopped (ADR 22). Nothing is written when
// that time passes, so the page works out which it is from the time, as it
// does with a hashtag's hours.
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

const asks = (count: number) => `${String(count)} ask${count === 1 ? "" : "s"}`;

// The one line that says how sorting stands: asks being sorted come first,
// then asks that stopped. With neither, there is no line.
export function sortingLine({ sorting, stopped }: SortingState): string | null {
  if (sorting > 0) return `Sorting ${asks(sorting)} with your rules`;
  if (stopped > 0) {
    return `${asks(stopped)} couldn't be sorted. Saving your rules tries again.`;
  }
  return null;
}
