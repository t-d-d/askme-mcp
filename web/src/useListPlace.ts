// Coming back to the list from a card. A card opens at the top of the page.
// When it closes, by "All asks", Back or Dismiss, or because its ask has
// gone, the list is back where it was when the card opened, and focus is on
// the link that opened the card: its row, or the top card's summary. If the
// ask has left the list or moved in it, focus goes to the ask that came after
// it, or with none left, to the last ask in the list (closing.ts). If that
// link is not wholly on the screen, the page scrolls only as far as it takes
// to show it and its outline, clear of the note after a dismissal
// (Asks.module.css).
//
// A card opened straight from its address did not open over the list, so
// the list comes back at the top, and focus is left where it falls.
//
// However the card opened, when nothing is left waiting on the tab, focus
// goes to the All clear headline, so a screen reader says what happened.
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { focusOnClosing } from "./closing";
import { cardHref } from "./screen";

// Takes the ask whose card is open, if one is, the ids of the list's asks,
// top card first, and the All clear headline while it shows. Gives the ref
// for the list's screen.
export function useListPlace(
  card: string | undefined,
  order: readonly string[],
  headline: RefObject<HTMLElement | null>,
) {
  const list = useRef<HTMLDivElement>(null);
  // The card drawn last time, if one was.
  const drawn = useRef<string | undefined>(undefined);
  // Whether the list showed its asks last time.
  const listing = useRef(false);
  // How far the list is scrolled while it shows its asks, and so how far it
  // was as a card opened over it. Null when it last showed none.
  const place = useRef<number | null>(null);
  // The list's asks as they stood when the card opened.
  const stood = useRef<readonly string[]>([]);

  // The place is kept as the list scrolls. It cannot be read as the
  // address changes: once the list's screen has been drawn anew, SignedIn
  // hears of the change first, and the card may already be drawn. The card's
  // own scrolling comes after it is drawn, so it is not kept.
  useEffect(() => {
    const scrolling = () => {
      if (listing.current) place.current = window.scrollY;
    };
    window.addEventListener("scroll", scrolling, { passive: true });
    return () => {
      window.removeEventListener("scroll", scrolling);
    };
  }, []);

  useLayoutEffect(() => {
    const was = drawn.current;
    drawn.current = card;
    listing.current = card === undefined && order.length > 0;
    if (card !== undefined) {
      if (card === was) return;
      stood.current = order;
      window.scrollTo(0, 0);
      return;
    }
    if (was === undefined) {
      place.current = listing.current ? window.scrollY : null;
      return;
    }
    const left = place.current;
    window.scrollTo(0, left ?? 0);
    if (order.length === 0) {
      headline.current?.focus({ preventScroll: true });
    } else if (left !== null) {
      const id = focusOnClosing(was, stood.current, order);
      // Each ask's card is opened by one link in the list, so the link is
      // found by where it leads.
      const link =
        id === undefined
          ? null
          : list.current?.querySelector<HTMLElement>(
              `a[href="${cardHref(id)}"]`,
            );
      if (link !== null && link !== undefined) {
        link.focus({ preventScroll: true });
        showWhole(link);
      }
    }
    place.current = listing.current ? window.scrollY : null;
  });

  return list;
}

// Scrolls the page only as far as it takes to show the whole of a link and
// the room its scroll margins keep: its focus outline, and the note after a
// dismissal (Asks.module.css). The browser's own nearest scrolling leaves a
// link on the screen where it is, though the room around it is not.
function showWhole(link: HTMLElement) {
  const { top, bottom } = link.getBoundingClientRect();
  const room = getComputedStyle(link);
  if (top - parseFloat(room.scrollMarginTop) < 0) {
    link.scrollIntoView({ block: "start", inline: "nearest" });
  } else if (
    bottom + parseFloat(room.scrollMarginBottom) >
    document.documentElement.clientHeight
  ) {
    link.scrollIntoView({ block: "end", inline: "nearest" });
  }
}
