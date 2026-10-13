// The service gives its times by its own clock, serviceAhead ahead of this
// browser's (load.ts).
import { levels, type Level } from "../../shared/page-api";

const minuteMs = 60_000;

export function age(
  postedAt: string,
  now: number,
  serviceAhead: number,
): string {
  const minutes = Math.floor(
    (now + serviceAhead - Date.parse(postedAt)) / minuteMs,
  );
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)} h`;
  return `${String(Math.floor(hours / 24))} d`;
}

export function waiting(
  postedAt: string,
  now: number,
  serviceAhead: number,
): string {
  const words = age(postedAt, now, serviceAhead);
  return words === "Just now" ? words : `Waiting ${words}`;
}

// By id on a tie, so the order is the same on every load.
export function longestWaitingFirst<
  Ask extends { id: string; postedAt: string },
>(asks: readonly Ask[]): Ask[] {
  return [...asks].sort(
    (a, b) =>
      Date.parse(a.postedAt) - Date.parse(b.postedAt) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

interface MayLapse {
  lapsesAt?: string | undefined;
}

const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;

const timeLeft = ({ lapsesAt }: MayLapse, now: number, serviceAhead: number) =>
  lapsesAt === undefined
    ? undefined
    : Date.parse(lapsesAt) - (now + serviceAhead);

const passed = (left: number | undefined) => left !== undefined && left <= 0;

export function lapsedAsks(
  asks: readonly (MayLapse & { id: string })[],
  now: number,
  serviceAhead: number,
): ReadonlySet<string> {
  return new Set(
    asks
      .filter((ask) => passed(timeLeft(ask, now, serviceAhead)))
      .map(({ id }) => id),
  );
}

// Parts in order: lapsing within the hour, each level, not sorted yet, lapsed.
function part(sort: { level: Level } | null, left: number | undefined) {
  if (passed(left)) return levels.length + 2;
  if (left !== undefined && left <= hourMs) return 0;
  return sort === null ? levels.length + 1 : levels.indexOf(sort.level) + 1;
}

// An ask that lapses within a day is placed by its time left. The rest tie,
// so a far-off time gains an ask nothing.
const placeInPart = (left: number | undefined) =>
  left !== undefined && !passed(left) && left <= dayMs ? left : dayMs + 1;

// Ties keep the longest-waiting order, since sort is stable.
export function inListOrder<
  Ask extends MayLapse & {
    id: string;
    postedAt: string;
    opened: boolean;
    sort: { level: Level } | null;
  },
>(asks: readonly Ask[], now: number, serviceAhead: number): Ask[] {
  const placed = longestWaitingFirst(asks).map((ask) => {
    const left = timeLeft(ask, now, serviceAhead);
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
