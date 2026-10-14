import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

// A control inside one of `areas` can go with focus on it, as a tab whose
// hashtag leaves the rules, a held line that empties, or All clear as it
// moves under the tabs. The browser then puts focus on the body. After the
// render the control went in, rescue moves it somewhere a screen reader can
// say. `areas` must be stable. Asks are not in them: their own focus is set
// as a card closes (useListPlace.ts).
export function useFocusRescue(
  areas: readonly RefObject<HTMLElement | null>[],
  rescue: () => void,
) {
  const last = useRef<Element | null>(null);
  useEffect(() => {
    const note = ({ target }: FocusEvent) => {
      last.current =
        target instanceof Element &&
        areas.some((area) => area.current?.contains(target) === true)
          ? target
          : null;
    };
    // A control that goes with focus fires focusout as it leaves, so this
    // looks once React is done. If the control is still on the page, focus
    // left it, as at a click on plain text, and nothing was lost.
    const forget = ({ target }: FocusEvent) => {
      queueMicrotask(() => {
        if (
          target === last.current &&
          target instanceof Node &&
          target.isConnected &&
          target !== document.activeElement
        ) {
          last.current = null;
        }
      });
    };
    document.addEventListener("focusin", note);
    document.addEventListener("focusout", forget);
    return () => {
      document.removeEventListener("focusin", note);
      document.removeEventListener("focusout", forget);
    };
  }, [areas]);
  useLayoutEffect(() => {
    const had = last.current;
    if (had === null || had.isConnected) return;
    // Only in the render it went in, so focus lost as a card opens is not
    // moved when the list comes back.
    last.current = null;
    const now = document.activeElement;
    if (now === null || now === document.body) rescue();
  });
}
