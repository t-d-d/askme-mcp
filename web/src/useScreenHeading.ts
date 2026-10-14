// Names the screen in the page's title, and when the screen was reached by
// following a link, not as the page opened, moves focus to its heading so a
// screen reader says where the person is. The heading is not a control: it
// takes tabIndex -1 and draws no outline. When a card closes, focus goes
// back to the list instead (useListPlace.ts).
import { useEffect, useRef } from "react";

export const listTitle = "askme";

export const screenTitle = (screen: string): string =>
  `${screen} | ${listTitle}`;

// Set once the address has changed on this page. Listening from the start
// sees every change, including one made before any screen was drawn.
let navigated = false;
if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    navigated = true;
  });
}

export function useScreenHeading(title: string) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = title;
    return () => {
      document.title = listTitle;
    };
  }, [title]);
  useEffect(() => {
    if (navigated) heading.current?.focus({ preventScroll: true });
  }, []);
  return heading;
}
