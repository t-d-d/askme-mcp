// How the list reads its asks: the order they come in, which asks have
// lapsed, and how long each has waited, in the short forms docs/design.md
// gives.
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

// An ask that may carry the time it lapses, as the page's API gives it.
interface MayLapse {
  lapsesAt?: string | undefined;
}

const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;

// How long until an ask lapses at a moment, or undefined for an ask with no
// time to lapse at.
const timeLeft = ({ lapsesAt }: MayLapse, now: number) =>
  lapsesAt === undefined ? undefined : Date.parse(lapsesAt) - now;

// Whether an ask's time has passed, by the time left. It has from the
// moment it lapses.
const passed = (left: number | undefined) => left !== undefined && left <= 0;

// The ids of the asks that have lapsed at a moment (PRD, "Web page"). A
// lapsed ask is not closed. It leaves the order and waits behind a line of
// its own.
export function lapsedAsks(
  asks: readonly (MayLapse & { id: string })[],
  now: number,
): ReadonlySet<string> {
  return new Set(
    asks.filter((ask) => passed(timeLeft(ask, now))).map(({ id }) => id),
  );
}

// The part of the list an ask goes in, by its level and the time it has
// left: first the asks that lapse within the hour, whatever their level,
// then each level, then the asks not sorted yet, and last the lapsed asks,
// when they are shown.
function part(sort: { level: Level } | null, left: number | undefined) {
  if (passed(left)) return levels.length + 2;
  if (left !== undefined && left <= hourMs) return 0;
  return sort === null ? levels.length + 1 : levels.indexOf(sort.level) + 1;
}

// An ask's place in its part, by the time it has left: that time, when it
// lapses within the next day, so those come first, soonest first. Every
// other ask has the same place after them, and keeps the order it waited
// in. So does every lapsed ask, in the part of its own.
const placeInPart = (left: number | undefined) =>
  left !== undefined && !passed(left) && left <= dayMs ? left : dayMs + 1;

// The order of the list at a moment (PRD, "Web page"). An ask that lapses
// within the hour comes first, whatever its level, soonest first. Then come
// the levels, higher first, and an ask not sorted yet waits below them until
// it is. At each, the asks that lapse within the next day come first,
// soonest first, and the rest follow, longest waiting first, so a far-off
// time gains an ask nothing. An opened ask sinks below the unopened ones in
// its part, and no further, and the opened ones keep the same order. A
// lapsed ask, when shown, comes after all of them, longest waiting first.
export function inListOrder<
  Ask extends MayLapse & {
    id: string;
    postedAt: string;
    opened: boolean;
    sort: { level: Level } | null;
  },
>(asks: readonly Ask[], now: number): Ask[] {
  const placed = longestWaitingFirst(asks).map((ask) => {
    const left = timeLeft(ask, now);
    return { ask, part: part(ask.sort, left), place: placeInPart(left) };
  });
  return placed
    .sort(
      (a, b) =>
        a.part - b.part ||
        Number(a.ask.opened) - Number(b.ask.opened) ||
        a.place - b.place,
    )
    .map(({ ask }) => ask);
}
