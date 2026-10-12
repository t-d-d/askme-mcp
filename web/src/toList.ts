import type { MouseEvent } from "react";
import { listHref, stepsBackToList } from "./screen";

// The entries before this page's own in the history, oldest first, where
// the browser can say.
function earlierEntries(): (string | null)[] | null {
  if (!("navigation" in window)) return null;
  const index = window.navigation.currentEntry?.index ?? -1;
  if (index < 0) return null;
  return window.navigation
    .entries()
    .slice(0, index)
    .map(({ url }) => url);
}

// Takes the person to the list from a card or another screen, as "All asks"
// and Dismiss do. When the list is a few of this page's own entries back in
// the history, the page goes back to it, so the history keeps one entry for
// the list however often the person comes and goes, and Back from it does
// not open what they left. Otherwise, as for a card opened straight from its
// address, the list takes the place of the entry shown. A browser that
// cannot say what is behind gets the same.
export function backToList(): void {
  const earlier = earlierEntries();
  const steps =
    earlier === null ? null : stepsBackToList(window.location.href, earlier);
  if (steps === null) window.location.replace(listHref);
  else window.history.go(-steps);
}

// Whether a click opens a link somewhere else, such as in a new tab, and so
// leaves this page as it is.
export const elsewhere = (event: MouseEvent): boolean =>
  event.button !== 0 ||
  event.ctrlKey ||
  event.metaKey ||
  event.shiftKey ||
  event.altKey;

// "All asks" is a real link to the list, so it still opens in a new tab.
// Followed here, it goes back to the list, unless the screen has kept the
// person where they are.
export function followToList(event: MouseEvent): void {
  if (event.isDefaultPrevented() || elsewhere(event)) return;
  event.preventDefault();
  backToList();
}
