import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

// A control inside `within` can go with focus on it, as a tab whose hashtag
// leaves the rules, a held line that empties, or All clear as it moves under
// the tabs. The browser then puts focus on the body. After the render the
// control went in, rescue moves it somewhere a screen reader can say.
export function useFocusRescue(
  within: RefObject<HTMLElement | null>,
  rescue: () => void,
) {
  const last = useRef<Element | null>(null);
  useEffect(() => {
    const note = ({ target }: FocusEvent) => {
      last.current =
        target instanceof Element && within.current?.contains(target) === true
          ? target
          : null;
    };
    document.addEventListener("focusin", note);
    return () => {
      document.removeEventListener("focusin", note);
    };
  }, [within]);
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
