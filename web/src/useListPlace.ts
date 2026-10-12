// Coming back to the list from a card. A card opens at the top of the page.
// When it closes, by "All asks", Back or Dismiss, or because its ask has
// gone, the list is back where it was when the card opened, and focus is on
// the link that opened the card: its row, or the top card's summary. If the
// ask has left the list, focus goes to the ask that came after it, or to the
// top card's summary when none did.
//
// A card opened straight from its address did not open over the list, so
// the list comes back at the top, and focus is left where it falls.
import { useEffect, useLayoutEffect, useRef } from "react";
import { cardHref } from "./screen";

// Takes the ask whose card is open, if one is, and the ids of the list's
// asks, top card first. Gives the ref for the list's screen.
export function useListPlace(
  card: string | undefined,
  order: readonly string[],
) {
  const list = useRef<HTMLDivElement>(null);
  // The card drawn last time, if one was.
  const drawn = useRef<string | undefined>(undefined);
  // Whether the list showed its asks last time.
  const listing = useRef(false);
  // How far the list is scrolled while it shows its asks, and so how far it
  // was as a card opened over it. Null when it last showed none.
  const place = useRef<number | null>(null);
  // The open card's ask and those after it, as the list stood when the card
  // opened.
  const from = useRef<readonly string[]>([]);

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
      const at = order.indexOf(card);
      from.current = at < 0 ? [] : order.slice(at);
      window.scrollTo(0, 0);
      return;
    }
    if (was === undefined) {
      place.current = listing.current ? window.scrollY : null;
      return;
    }
    const left = place.current;
    window.scrollTo(0, left ?? 0);
    place.current = listing.current ? window.scrollY : null;
    if (left === null) return;
    // Each ask's card is opened by one link in the list, so the link is
    // found by where it leads.
    const link = [...from.current, ...order.slice(0, 1)]
      .map((id) =>
        list.current?.querySelector<HTMLElement>(`a[href="${cardHref(id)}"]`),
      )
      .find((found) => found !== null && found !== undefined);
    link?.focus({ preventScroll: true });
  });

  return list;
}
