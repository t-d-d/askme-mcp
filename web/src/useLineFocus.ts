import { useCallback, useRef } from "react";

// A line is drawn anew as it moves between the tabs and the foot of All
// clear, so its control goes and another comes in one render. The stable
// ref callback's cleanup sees the old control still focused, and the new one
// clears the flag as it takes focus, so StrictMode's second run is harmless.
// With no control in its place, the page reads lostFocus after the render.
export function useLineFocus() {
  const hadFocus = useRef(false);
  const keep = useCallback((control: HTMLButtonElement) => {
    if (hadFocus.current) {
      hadFocus.current = false;
      control.focus();
    }
    return () => {
      if (control === document.activeElement) hadFocus.current = true;
    };
  }, []);
  const lostFocus = useCallback(() => {
    const had = hadFocus.current;
    hadFocus.current = false;
    return had;
  }, []);
  return { keep, lostFocus };
}
