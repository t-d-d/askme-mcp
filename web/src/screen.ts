import { askIdPattern } from "../../shared/page-api";

// The page's screens. It names them in the address's fragment
// (SignedIn.tsx): #connect, #rules, and anything else for the list.
export type Screen = "asks" | "connect" | "rules";

export const screenIn = (hash: string): Screen =>
  hash === "#connect" ? "connect" : hash === "#rules" ? "rules" : "asks";

// The open card's address. An ask's card is the list's screen with that ask
// open, as #ask/<id>, so Back closes it.
const cardPrefix = "#ask/";

export const cardHref = (id: string): string => `${cardPrefix}${id}`;

// The id of the ask whose card the fragment opens, or null for none.
export function cardIn(hash: string): string | null {
  if (!hash.startsWith(cardPrefix)) return null;
  const id = hash.slice(cardPrefix.length);
  return askIdPattern.test(id) ? id : null;
}
