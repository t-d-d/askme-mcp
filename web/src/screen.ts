// The open card's address. The page names its screens in the address's
// fragment (SignedIn.tsx), and an ask's card is the list's screen with that
// ask open, as #ask/<id>, so Back closes it.
export const cardHref = (id: string): string => `#ask/${id}`;

// The id of the ask whose card the fragment opens, or null for none.
export function cardIn(hash: string): string | null {
  return /^#ask\/([A-Za-z0-9_-]{1,64})$/u.exec(hash)?.[1] ?? null;
}
