// When a daily cap resets, as the page says it: "It resets at 01:00", with
// the time in the person's time zone (docs/design.md, "Words"). Every daily
// cap counts in UTC days, so it resets at the next midnight UTC, and the
// page works this out for itself, by the service's clock.
import { minutesInDay, wallClock } from "./hours";

const dayLength = minutesInDay * 60 * 1000;

// The next midnight UTC after a moment.
export function resetsAt(at: number): number {
  return (Math.floor(at / dayLength) + 1) * dayLength;
}

// The next midnight UTC by the service's clock after a moment on this
// browser's, given back on this browser's clock. The service counts every
// daily cap by its own clock, which is serviceAhead ahead of this one
// (load.ts). On a clock a few minutes out, this browser's own next midnight
// would come a few minutes early or late, or, just past it on a fast clock,
// a day late. serviceAhead errs behind by a second or so, which places a
// refused press a little early on the service's clock. It still falls in
// the day the cap was spent: at askme's rate limit, no account can spend
// its cap in the first few minutes of a day.
export function resetsHere(at: number, serviceAhead: number): number {
  return resetsAt(at + serviceAhead) - serviceAhead;
}

// A moment on the 24-hour clock in a time zone or, without one, in this
// browser's. In a time zone this browser does not know, it gives the time
// in UTC.
export function clockTime(at: number, timeZone?: string): string {
  const minute =
    wallClock(at, timeZone)?.minute ?? Math.floor((at % dayLength) / 60_000);
  const hours = String(Math.floor(minute / 60)).padStart(2, "0");
  const minutes = String(minute % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

// The next midnight UTC after a moment, on the clock as above.
export function resetTime(at: number, timeZone?: string): string {
  return clockTime(resetsAt(at), timeZone);
}
