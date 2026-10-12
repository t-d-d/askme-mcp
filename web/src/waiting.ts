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
// of them. At each, an opened ask goes after the unopened ones.
const place = ({
  sort,
  opened,
}: {
  sort: { level: Level } | null;
  opened: boolean;
}) =>
  (sort === null ? levels.length : levels.indexOf(sort.level)) * 2 +
  (opened ? 1 : 0);

// Higher level first, then longest waiting (PRD, "Web page"). An ask not
// sorted yet waits below the sorted ones until it is. An opened ask sinks
// below the unopened ones at its level, and no further.
export function inListOrder<
  Ask extends {
    id: string;
    postedAt: string;
    opened: boolean;
    sort: { level: Level } | null;
  },
>(asks: readonly Ask[]): Ask[] {
  return longestWaitingFirst(asks).sort((a, b) => place(a) - place(b));
}
