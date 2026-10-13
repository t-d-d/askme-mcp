import type { MouseEvent } from "react";
import { listHref, stepsBackToList } from "./screen";

function earlierEntries(): NavigationHistoryEntry[] {
  if (!("navigation" in window)) return [];
  const index = window.navigation.currentEntry?.index ?? -1;
  return index < 0 ? [] : window.navigation.entries().slice(0, index);
}

// Goes back to the list's entry when it is a few of this page's own entries
// back, so the history keeps one entry for the list and Back from it does
// not reopen what the person left. traverseTo the entry, not a number of
// steps, so a second click before the first lands goes no further.
export function backToList(): void {
  const earlier = earlierEntries();
  const steps = stepsBackToList(
    window.location.href,
    earlier.map(({ url, sameDocument }) => (sameDocument ? url : null)),
  );
  if (steps === 0) return;
  const target = steps === null ? undefined : earlier[earlier.length - steps];
  if (target === undefined) window.location.replace(listHref);
  else window.navigation.traverseTo(target.key);
}

// A click that opens the link somewhere else, such as in a new tab.
export const elsewhere = (event: MouseEvent): boolean =>
  event.button !== 0 ||
  event.ctrlKey ||
  event.metaKey ||
  event.shiftKey ||
  event.altKey;

// "All asks" is a real link, so it still opens in a new tab. A screen that
// keeps the person where they are has prevented the default first.
export function followToList(event: MouseEvent): void {
  if (event.isDefaultPrevented() || elsewhere(event)) return;
  event.preventDefault();
  backToList();
}
