import type { MouseEvent } from "react";
import { listHref, stepsBackToList } from "./screen";

// The entries before the one shown in the history, oldest first: none
// where the browser cannot say.
function earlierEntries(): NavigationHistoryEntry[] {
  if (!("navigation" in window)) return [];
  const index = window.navigation.currentEntry?.index ?? -1;
  return index < 0 ? [] : window.navigation.entries().slice(0, index);
}

// Takes the person to the list from a card or another screen, as "All asks"
// and Dismiss do. When the list is a few of this page's own entries back in
// the history, the page goes back to that entry, so the history keeps one
// entry for the list however often the person comes and goes, and Back
// from it does not open what they left. It goes to the entry itself rather
// than a number of steps back, so a second click before the first lands
// goes no further. An entry from an earlier load of the page ends the
// search, so going back never loads the page again. With no list to go
// back to, as for a card opened straight from its address, or in a browser
// that cannot say what is behind, the list takes the place of the entry
// shown. On the list already, it does nothing.
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
