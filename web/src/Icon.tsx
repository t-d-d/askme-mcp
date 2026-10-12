// The icons a card's buttons carry: inline SVG in the text colour (ADR 14),
// drawn as in the mockup. Each is hidden from screen readers, and its
// button carries the words.
import type { ReactNode } from "react";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

// Listen.
export function SpeakerIcon() {
  return (
    <Icon>
      <path d="M11 5 6 9H3v6h3l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </Icon>
  );
}

// Reply in the session.
export function SessionIcon() {
  return (
    <Icon>
      <path d="M20 12a7 7 0 0 1-7 7H6l-3 2.5V12a7 7 0 0 1 7-7h3a7 7 0 0 1 7 7z" />
    </Icon>
  );
}

// Back to all asks.
export function BackIcon() {
  return (
    <Icon>
      <path d="M15 18l-6-6 6-6" />
    </Icon>
  );
}
