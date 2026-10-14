import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { aheadSince, countOn, send, serviceAhead, type Moment } from "./load";

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
  const then = { date: at("2026-10-12T23:55:00Z"), steady: 1_000 };
  const ahead = 3 * minute;
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

  it("counts the time a visible page's device slept, which performance.now() may not, once its clock has moved on an hour", () => {
    const now = { date: then.date + 60 * minute, steady: then.steady };
    expect(serviceAt(now, true)).toBe(then.date + ahead + 60 * minute);
  });

  it("moves the service's time on by performance.now() alone, on a page visible throughout, when the device's clock is put forward by just under an hour", () => {
    const now = {
      date: then.date + 10_000 + 60 * minute - 1,
      steady: then.steady + 10_000,
    };
    expect(serviceAt(now, true)).toBe(then.date + ahead + 10_000);
  });

  it("counts no less time than performance.now() on a hidden page whose device's clock is put back", () => {
    const now = {
      date: then.date + 10_000 - 3 * minute,
      steady: then.steady + 10_000,
    };
    expect(serviceAt(now, false)).toBe(then.date + ahead + 10_000);
  });
});

describe("how far the service's clock is ahead, counted on from poll to poll while polls fail", () => {
  const minute = 60 * 1000;
  const reached = (ahead: number) => ({
    serviceAhead: ahead,
    at: { date: at("2026-10-12T23:55:00Z"), steady: 1_000 },
    visibilityChanges: 0,
  });
  const failedAfter = (from: { at: Moment }, moved: number) => ({
    date: from.at.date + 10_000 + moved,
    steady: from.at.steady + 10_000,
  });

  // Counted in one step, the correction and the sleep add up to 63 or 58
  // minutes, which would read as a sleep of 63 minutes, or as no sleep.
  it.each([
    ["slow", 3 * minute, 60 * minute],
    ["fast", -3 * minute, 61 * minute],
  ])(
    "judges a clock a few minutes %s put right, and a sleep after it with the page showing, each by its own step",
    (_, ahead, sleep) => {
      const corrected = countOn(
        reached(ahead),
        failedAfter(reached(ahead), ahead),
        0,
      );
      expect(corrected.serviceAhead).toBe(0);
      const woken = countOn(corrected, failedAfter(corrected, sleep), 0);
      expect(woken.serviceAhead).toBe(0);
      expect(woken.at).toEqual(failedAfter(corrected, sleep));
    },
  );

  it("reads the page as hidden in a step when it was hidden or shown in that step, and not before", () => {
    const hidden = countOn(reached(0), failedAfter(reached(0), 0), 2);
    expect(hidden.visibilityChanges).toBe(2);
    const putRight = countOn(hidden, failedAfter(hidden, 10 * minute), 2);
    expect(putRight.serviceAhead).toBe(-10 * minute);
    const shownAgain = countOn(hidden, failedAfter(hidden, 10 * minute), 3);
    expect(shownAgain.serviceAhead).toBe(0);
  });
});

describe("a save's answer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const answering = (body: string) => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(body)));
  };
  const saved = z.object({ text: z.string() });
  const token = () => Promise.resolve("token");

  it("is the answer read by its schema", async () => {
    answering(JSON.stringify({ text: "#work" }));
    await expect(send("/rules", {}, saved, token)).resolves.toEqual({
      text: "#work",
    });
  });

  it("is null, not an error, when the save went through but its answer fails its schema", async () => {
    answering(JSON.stringify({ shape: "new" }));
    await expect(send("/rules", {}, saved, token)).resolves.toBeNull();
  });

  it("is an error when it is not JSON at all", async () => {
    answering("<!doctype html>");
    await expect(send("/rules", {}, saved, token)).rejects.toThrow();
  });
});
