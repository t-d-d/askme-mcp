// When a daily cap resets, as the page says it: "It resets at 01:00", with
// the time in the person's time zone (docs/design.md, "Words"). Every daily
// cap counts in UTC days, so it resets at the next midnight UTC, and the
// page works this out for itself.
import { minutesInDay, wallClock } from "./hours";

const dayLength = minutesInDay * 60 * 1000;

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
  return clockTime((Math.floor(at / dayLength) + 1) * dayLength, timeZone);
}
