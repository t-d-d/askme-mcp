import { askIdPattern } from "../../shared/page-api";

export type Screen = "asks" | "connect" | "rules";

// A screen with unsaved work passes the question to ask before it is left,
// or null once it can be left without asking.
export type AskFirst = (question: string | null) => void;

export const screenIn = (hash: string): Screen =>
  hash === "#connect" ? "connect" : hash === "#rules" ? "rules" : "asks";

// A card has its own fragment, so Back closes it.
const cardPrefix = "#ask/";

export const cardHref = (id: string): string => `${cardPrefix}${id}`;

export function cardIn(hash: string): string | null {
  if (!hash.startsWith(cardPrefix)) return null;
  const id = hash.slice(cardPrefix.length);
  return askIdPattern.test(id) ? id : null;
}

export const listHref = "#asks";

const showsList = (hash: string): boolean =>
  screenIn(hash) === "asks" && cardIn(hash) === null;

// earlier is oldest first, with null for an entry the browser cannot read.
// The search ends at the first that is not this page's own, or unreadable.
// 0 when the list shows already, null with no list behind.
export function stepsBackToList(
  here: string,
  earlier: readonly (string | null)[],
): number | null {
  const page = new URL(here);
  if (showsList(page.hash)) return 0;
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
