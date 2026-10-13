import type { ReactNode } from "react";
import { NewTabLink } from "./NewTabLink";

// A new tab keeps the list as it was. The link cannot be dragged, so a swipe
// that starts on it moves its card.
export function OutLink({
  href,
  className,
  label,
  onFollowed,
  children,
}: {
  href: string;
  className: string | undefined;
  label?: string;
  onFollowed: () => void;
  children: ReactNode;
}) {
  return (
    <NewTabLink
      className={className}
      href={href}
      aria-label={label}
      draggable={false}
      onClick={onFollowed}
      onAuxClick={(event) => {
        if (event.button === 1) onFollowed();
      }}
    >
      {children}
    </NewTabLink>
  );
}
