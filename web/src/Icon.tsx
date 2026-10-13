import type { ReactNode } from "react";

// Hidden from screen readers, so the button around an icon carries the words.
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

export function SpeakerIcon() {
  return (
    <Icon>
      <path d="M11 5 6 9H3v6h3l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </Icon>
  );
}

export function SessionIcon() {
  return (
    <Icon>
      <path d="M20 12a7 7 0 0 1-7 7H6l-3 2.5V12a7 7 0 0 1 7-7h3a7 7 0 0 1 7 7z" />
    </Icon>
  );
}

export function BackIcon() {
  return (
    <Icon>
      <path d="M15 18l-6-6 6-6" />
    </Icon>
  );
}
