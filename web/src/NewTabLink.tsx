import { useId, type ComponentPropsWithoutRef } from "react";

// A link that opens in a new tab and tells the new page nothing about
// askme. Its spoken name ends with "(opens in a new tab)", so a screen
// reader user knows why Back does nothing there. The words are in a hidden
// span, which aria-labelledby names after the link itself, and the screen
// shows nothing new. The span is outside the link because Playwright,
// unlike Chromium, leaves a hidden span inside the link out of the name,
// and the browser tests read names through Playwright.
export function NewTabLink({
  children,
  ...link
}: Omit<
  ComponentPropsWithoutRef<"a">,
  "id" | "target" | "rel" | "aria-labelledby"
>) {
  const id = useId();
  const words = useId();
  return (
    <>
      <a
        {...link}
        id={id}
        target="_blank"
        rel="noopener noreferrer"
        aria-labelledby={`${id} ${words}`}
      >
        {children}
      </a>
      <span id={words} hidden>
        (opens in a new tab)
      </span>
    </>
  );
}
