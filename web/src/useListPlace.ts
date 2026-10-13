// When a card closes, puts the list back where it was as the card opened,
// with focus on the link that opened it, or the next one (closing.ts).
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { focusOnClosing } from "./closing";
import { cardHref } from "./screen";

export function useListPlace(
  card: string | undefined,
  order: readonly string[],
  headline: RefObject<HTMLElement | null>,
) {
  const list = useRef<HTMLDivElement>(null);
  const drawn = useRef<string | undefined>(undefined);
  const listing = useRef(false);
  // The list's scroll position, or null when it showed no asks, as before a
  // card opened straight from its address.
  const place = useRef<number | null>(null);
  // The list's asks as they stood when the card opened.
  const stood = useRef<readonly string[]>([]);

  // Kept on scroll, not read as the address changes: SignedIn hears of the
  // change first, and the card may already be drawn by then.
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
      // Each card has one link to it in the list.
      const link =
        id === undefined
          ? null
          : list.current?.querySelector<HTMLElement>(
              `a[href="${cardHref(id)}"]`,
            );
      if (link) {
        link.focus({ preventScroll: true });
        showWhole(link);
      }
    }
    place.current = listing.current ? window.scrollY : null;
  });

  return list;
}

// Not scrollIntoView with block "nearest": that leaves a link that is on the
// screen where it is, even when its scroll margins (Asks.module.css) are not.
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
