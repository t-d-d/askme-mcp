// Every daily cap counts in UTC days, so it resets at midnight UTC.
import { minutesInDay, wallClock } from "./hours";

const dayLength = minutesInDay * 60 * 1000;

export function resetsAt(at: number): number {
  return (Math.floor(at / dayLength) + 1) * dayLength;
}

// By the service's clock, since this browser's may be minutes out, and just
// past midnight on a fast clock would give a day late. serviceAhead errs a
// second or so behind, which is safe: at askme's rate limit no account can
// spend its cap in the first few minutes of a day.
export function resetsHere(at: number, serviceAhead: number): number {
  return resetsAt(at + serviceAhead) - serviceAhead;
}

export function clockTime(at: number, timeZone?: string): string {
  const minute =
    wallClock(at, timeZone)?.minute ?? Math.floor((at % dayLength) / 60_000);
  const hours = String(Math.floor(minute / 60)).padStart(2, "0");
  const minutes = String(minute % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function resetTime(at: number, timeZone?: string): string {
  return clockTime(resetsAt(at), timeZone);
}
