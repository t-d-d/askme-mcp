import { askIdPattern } from "../../shared/page-api";

// The open card's address. The page names its screens in the address's
// fragment (SignedIn.tsx), and an ask's card is the list's screen with that
// ask open, as #ask/<id>, so Back closes it.
const cardPrefix = "#ask/";

export const cardHref = (id: string): string => `${cardPrefix}${id}`;

// The id of the ask whose card the fragment opens, or null for none.
export function cardIn(hash: string): string | null {
  if (!hash.startsWith(cardPrefix)) return null;
  const id = hash.slice(cardPrefix.length);
  return askIdPattern.test(id) ? id : null;
}
