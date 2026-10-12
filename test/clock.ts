// The service reads the time with new Date(), and counts each call against a
// minute's window and a day's. A test that fills a count and then expects a
// call to be counted against it stops the clock first. Otherwise it fails
// whenever the real clock crosses a minute partway through.
import { vi } from "vitest";

// The middle of a minute and of a UTC day. With the clock stopped here, a
// test's calls are all counted in the same minute and the same day as the
// counts it filled, however close the real clock is to the end of either.
export const noon = new Date("2026-10-11T12:00:30.000Z");

// Stops the clock at a moment, for the service and the token alike. Only the
// date stands still, so the timers the database client and the fake issuer
// wait on still run. vi.setSystemTime moves the stopped clock, and
// vi.useRealTimers starts it again.
export function stopClockAt(moment: Date): void {
  vi.useFakeTimers({ toFake: ["Date"], now: moment });
}
