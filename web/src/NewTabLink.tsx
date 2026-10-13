import { useId, type ComponentPropsWithoutRef } from "react";

// The spoken name ends "(opens in a new tab)", so a screen reader user knows
// why Back does nothing there. The hidden span sits outside the link because
// Playwright, unlike Chromium, leaves a hidden span inside a link out of its
// name, and the browser tests read names through Playwright.
export function NewTabLink({
  children,
  ...link
}: Omit<
  ComponentPropsWithoutRef<"a">,
  "id" | "target" | "rel" | "aria-labelledby"
>) {
  const id = useId();
  const words = `${id}-words`;
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
