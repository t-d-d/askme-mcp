// The service counts calls in a minute's window and a day's, by new Date().
// A test that fills a count and expects a call counted against it stops the
// clock, or it fails whenever the real clock crosses a minute partway through.
import { onTestFinished, vi } from "vitest";

// The middle of a minute and of a UTC day.
export const noon = new Date("2026-10-11T12:00:30.000Z");

// Only the date is faked, so timers still run.
export function stopClockAt(moment: Date): void {
  vi.useFakeTimers({ toFake: ["Date"], now: moment });
}

// For a test that also needs time to pass between its calls: two saves at
// one stopped moment would queue jobs with the same deduplication id, and
// the queue would drop the second. The date stands still between steps, so
// they are a millisecond, the shortest a timer takes. In steps of 20, the
// default, a fast runner made both saves inside one.
export function startClockAt(moment: Date): void {
  vi.useFakeTimers({
    toFake: ["Date"],
    now: moment,
    shouldAdvanceTime: true,
    advanceTimeDelta: 1,
  });
  onTestFinished(() => {
    vi.useRealTimers();
  });
}
