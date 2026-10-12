import type { ReactNode } from "react";

// A link to where the work is, or back to the agent's session. It opens in
// a new tab, so the list stays as it was, and tells the new page nothing
// about askme. Following it marks the ask as opened. It cannot be dragged
// away, so a swipe that starts on it moves its card.
export function OutLink({
  href,
  className,
  label,
  onFollowed,
  children,
}: {
  href: string;
  className: string | undefined;
  // The words for a link that shows only an icon.
  label?: string;
  onFollowed: () => void;
  children: ReactNode;
}) {
  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      draggable={false}
      onClick={onFollowed}
      onAuxClick={(event) => {
        if (event.button === 1) onFollowed();
      }}
    >
      {children}
    </a>
  );
}
