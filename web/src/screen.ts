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

// The list's own address, for a screen with no list behind it to go back to.
export const listHref = "#asks";

// Whether the fragment shows the list, with no card open over it.
const showsList = (hash: string): boolean =>
  screenIn(hash) === "asks" && cardIn(hash) === null;

// How many entries back in the history the nearest one is that shows the
// list, given the address shown and those of the entries before it, oldest
// first, with null for one the browser cannot read. Only this page's own
// entries count, so the search ends at the first that is not one, and at
// the first it cannot read. Null when there is no list to go back to.
export function stepsBackToList(
  here: string,
  earlier: readonly (string | null)[],
): number | null {
  const page = new URL(here);
  for (let steps = 1; steps <= earlier.length; steps += 1) {
    const address = earlier[earlier.length - steps];
    if (address === null || address === undefined) return null;
    const entry = new URL(address);
    if (
      entry.origin !== page.origin ||
      entry.pathname !== page.pathname ||
      entry.search !== page.search
    ) {
      return null;
    }
    if (showsList(entry.hash)) return steps;
  }
  return null;
}
