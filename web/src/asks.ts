// How the list reads its asks: the order they come in, and how long each
// has waited, in the short forms docs/design.md gives.
import { levels, type Level } from "../../shared/page-api";

const minuteMs = 60_000;

// "Just now", "4 min", "1 h" or "2 d".
export function age(postedAt: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(postedAt)) / minuteMs);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)} h`;
  return `${String(Math.floor(hours / 24))} d`;
}

// The top card says "Waiting 4 min", or "Just now".
export function waiting(postedAt: string, now: number): string {
  const words = age(postedAt, now);
  return words === "Just now" ? words : `Waiting ${words}`;
}

// Longest waiting first, and by id when two were posted at once, so the
// order is the same on every load.
export function longestWaitingFirst<
  Ask extends { id: string; postedAt: string },
>(asks: readonly Ask[]): Ask[] {
  return [...asks].sort(
    (a, b) =>
      Date.parse(a.postedAt) - Date.parse(b.postedAt) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

// Where each level goes in the list, and an ask not sorted yet after all
// of them.
const place = (sort: { level: Level } | null) =>
  sort === null ? levels.length : levels.indexOf(sort.level);

// Higher level first, then longest waiting (PRD, "Web page"). An ask not
// sorted yet waits below the sorted ones until it is.
export function inListOrder<
  Ask extends {
    id: string;
    postedAt: string;
    sort: { level: Level } | null;
  },
>(asks: readonly Ask[]): Ask[] {
  return longestWaitingFirst(asks).sort(
    (a, b) => place(a.sort) - place(b.sort),
  );
}

// The tab the list is on: one of the account's hashtags, by name, or
// Everything.
export type Tab = string | typeof everything;

export const everything = null;

// The asks a tab lists: every ask on Everything, and on a hashtag's tab only
// the asks sorted into that hashtag.
export function onTab<
  Ask extends { sort: { hashtags: readonly string[] } | null },
>(asks: readonly Ask[], tab: Tab): Ask[] {
  return tab === everything
    ? [...asks]
    : asks.filter((ask) => ask.sort?.hashtags.includes(tab) === true);
}

// The hashtag an ask is shown under, whose colour its buttons take: its
// first, in the rules' order, on Everything, and the tab's own on a
// hashtag's tab (docs/design.md, "Colour rules").
export function shownUnder(
  sort: { hashtags: readonly string[] },
  tab: Tab,
): string | undefined {
  return tab ?? sort.hashtags[0];
}
