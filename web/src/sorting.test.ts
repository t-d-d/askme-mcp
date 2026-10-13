import { describe, expect, it } from "vitest";
import { capSpentUntil, sortingLine, sortingState } from "./sorting";

const now = Date.parse("2026-10-12T09:00:00.000Z");
const minute = 60_000;
const until = (offset: number) => ({
  sortingUntil: new Date(now + offset).toISOString(),
});

describe("how sorting stands", () => {
  it("counts an ask behind the rules as sorting until its time, and stopped from then", () => {
    expect(
      sortingState([until(minute), until(-minute), until(0), {}], now, 0),
    ).toEqual({ sorting: 1, stopped: 2 });
  });

  it("counts an ask sorted with the rules in force as neither", () => {
    expect(sortingState([{}, {}], now, 0)).toEqual({ sorting: 0, stopped: 0 });
  });

  it("moves an ask from sorting to stopped as time passes", () => {
    const asks = [until(minute)];
    expect(sortingState(asks, now, 0)).toEqual({ sorting: 1, stopped: 0 });
    expect(sortingState(asks, now + minute, 0)).toEqual({
      sorting: 0,
      stopped: 1,
    });
  });

  // The service gives each ask's time by its own clock, which the poll's
  // Date header gives (load.ts). For an ask that turns stopped at 09:01 by
  // the service's clock, a clock three minutes fast reads 09:04 then, and
  // one three minutes slow reads 08:58.
  it("moves an ask to stopped when the service's clock reaches its time, on a clock a few minutes out", () => {
    const asks = [until(minute)];
    const fast = -3 * minute;
    expect(sortingState(asks, now + 4 * minute - 1, fast)).toEqual({
      sorting: 1,
      stopped: 0,
    });
    expect(sortingState(asks, now + 4 * minute, fast)).toEqual({
      sorting: 0,
      stopped: 1,
    });
    const slow = 3 * minute;
    expect(sortingState(asks, now - 2 * minute - 1, slow)).toEqual({
      sorting: 1,
      stopped: 0,
    });
    expect(sortingState(asks, now - 2 * minute, slow)).toEqual({
      sorting: 0,
      stopped: 1,
    });
  });
});

describe("the daily cap on model calls", () => {
  const resets = "2026-10-13T00:00:00.000Z";

  it("is spent until the time the list gives, and not from then", () => {
    expect(capSpentUntil(resets, Date.parse(resets) - 1, 0)).toBe(
      Date.parse(resets),
    );
    expect(capSpentUntil(resets, Date.parse(resets), 0)).toBeNull();
    expect(capSpentUntil(resets, Date.parse(resets) + minute, 0)).toBeNull();
  });

  it("is not spent when the list gives no time", () => {
    expect(capSpentUntil(undefined, now, 0)).toBeNull();
  });

  // The service counts the cap by its own clock, which the poll's Date
  // header gives (load.ts). On a clock three minutes fast, the cap resets
  // at 00:03 by this browser's clock, and on one three minutes slow at
  // 23:57. Either way, it is the time the list gives that comes back.
  it("is spent until the service's clock reaches the time, on a clock a few minutes out", () => {
    const fast = -3 * minute;
    expect(
      capSpentUntil(resets, Date.parse("2026-10-13T00:02:59Z"), fast),
    ).toBe(Date.parse(resets));
    expect(
      capSpentUntil(resets, Date.parse("2026-10-13T00:03:00Z"), fast),
    ).toBeNull();
    const slow = 3 * minute;
    expect(
      capSpentUntil(resets, Date.parse("2026-10-12T23:56:59Z"), slow),
    ).toBe(Date.parse(resets));
    expect(
      capSpentUntil(resets, Date.parse("2026-10-12T23:57:00Z"), slow),
    ).toBeNull();
  });
});

describe("the sorting line", () => {
  it("says the daily limit is reached and when it resets, before anything else", () => {
    expect(sortingLine({ sorting: 40, stopped: 3 }, "01:00")).toBe(
      "Today's sorting limit is reached. It resets at 01:00.",
    );
    expect(sortingLine({ sorting: 0, stopped: 0 }, "20:00")).toBe(
      "Today's sorting limit is reached. It resets at 20:00.",
    );
  });

  it("says how many asks are being sorted, before any that stopped", () => {
    expect(sortingLine({ sorting: 40, stopped: 3 })).toBe(
      "Sorting 40 asks with your rules",
    );
    expect(sortingLine({ sorting: 1, stopped: 0 })).toBe(
      "Sorting 1 ask with your rules",
    );
  });

  it("says how many could not be sorted once none is being sorted", () => {
    expect(sortingLine({ sorting: 0, stopped: 3 })).toBe(
      "3 asks couldn't be sorted. Saving your rules tries again.",
    );
    expect(sortingLine({ sorting: 0, stopped: 1 })).toBe(
      "1 ask couldn't be sorted. Saving your rules tries again.",
    );
  });

  it("says nothing when every ask is sorted with the rules in force", () => {
    expect(sortingLine({ sorting: 0, stopped: 0 })).toBeNull();
  });
});
