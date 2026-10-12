import { useCallback, useRef } from "react";

// Keeps focus on a line's control as the line moves (Asks.tsx). A line is
// drawn anew as it moves between the tabs and the foot of All clear, so its
// control goes and another comes in the same render. The ref callback stays
// the same between renders, so React calls its cleanup only as a control
// goes, while it still has focus, and calls it again only as one comes. The
// control that takes focus clears the flag, so StrictMode in development,
// which runs the cleanup and the call a second time, leaves the flag clear.
//
// The flag stays set when a control goes with none in its place. The page
// takes it after the render, and sends focus somewhere else.
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
  // Whether a control went with focus and none has taken it since. It
  // clears the flag.
  const lostFocus = useCallback(() => {
    const had = hadFocus.current;
    hadFocus.current = false;
    return had;
  }, []);
  return { keep, lostFocus };
}
