import { describe, expect, it } from "vitest";
import { aheadSince, serviceAhead, type Moment } from "./load";

const at = (iso: string) => Date.parse(iso);

const answered = (date?: string) =>
  new Response(null, date === undefined ? {} : { headers: { date } });

describe("how far the service's clock is ahead of this browser's", () => {
  it("is read from the Date header of the service's answer", () => {
    const received = at("2026-10-12T23:55:00Z");
    expect(
      serviceAhead(answered("Mon, 12 Oct 2026 23:58:00 GMT"), received),
    ).toBe(3 * 60 * 1000);
    expect(
      serviceAhead(answered("Tue, 13 Oct 2026 00:01:00 GMT"), received),
    ).toBe(6 * 60 * 1000);
  });

  it("is behind when this browser's clock is fast", () => {
    expect(
      serviceAhead(
        answered("Mon, 12 Oct 2026 23:58:00 GMT"),
        at("2026-10-13T00:01:00Z"),
      ),
    ).toBe(-3 * 60 * 1000);
  });

  it("is nothing when the answer has no Date header, or one that is not a time", () => {
    const received = at("2026-10-12T23:55:00Z");
    expect(serviceAhead(answered(), received)).toBe(0);
    expect(serviceAhead(answered("soon"), received)).toBe(0);
  });
});

describe("how far the service's clock is ahead after polls that failed", () => {
  const minute = 60 * 1000;
  // The last poll that reached askme, on both of this browser's clocks,
  // when the service's clock was three minutes ahead.
  const then = { date: at("2026-10-12T23:55:00Z"), steady: 1_000 };
  const ahead = 3 * minute;
  // The service's time at a later moment, by how far ahead it is then.
  const serviceAt = (now: Moment, visibleThroughout: boolean) =>
    now.date + aheadSince(ahead, then, now, visibleThroughout);

  it("stays as it was while the device's clock keeps time", () => {
    const now = { date: then.date + 10_000, steady: then.steady + 10_000 };
    expect(aheadSince(ahead, then, now, true)).toBe(ahead);
    expect(aheadSince(ahead, then, now, false)).toBe(ahead);
  });

  it.each([
    ["forward", 3 * minute],
    ["back", -3 * minute],
  ])(
    "moves the service's time on by performance.now() alone, on a page visible throughout, when the device's clock is put %s",
    (_, change) => {
      const now = {
        date: then.date + 10_000 + change,
        steady: then.steady + 10_000,
      };
      expect(serviceAt(now, true)).toBe(then.date + ahead + 10_000);
    },
  );

  it("counts the time a hidden page's device slept, which performance.now() may not", () => {
    const now = { date: then.date + 60 * minute, steady: then.steady + 10 };
    expect(serviceAt(now, false)).toBe(then.date + ahead + 60 * minute);
  });

  it("counts no less time than performance.now() on a hidden page whose device's clock is put back", () => {
    const now = {
      date: then.date + 10_000 - 3 * minute,
      steady: then.steady + 10_000,
    };
    expect(serviceAt(now, false)).toBe(then.date + ahead + 10_000);
  });
});
