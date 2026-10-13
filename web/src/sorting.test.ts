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
      sortingState([until(minute), until(-minute), until(0), {}], now),
    ).toEqual({ sorting: 1, stopped: 2 });
  });

  it("counts an ask sorted with the rules in force as neither", () => {
    expect(sortingState([{}, {}], now)).toEqual({ sorting: 0, stopped: 0 });
  });

  it("moves an ask from sorting to stopped as time passes", () => {
    const asks = [until(minute)];
    expect(sortingState(asks, now)).toEqual({ sorting: 1, stopped: 0 });
    expect(sortingState(asks, now + minute)).toEqual({
      sorting: 0,
      stopped: 1,
    });
  });
});

describe("the daily cap on model calls", () => {
  const resets = "2026-10-13T00:00:00.000Z";

  it("is spent until the time the list gives, and not from then", () => {
    expect(capSpentUntil(resets, Date.parse(resets) - 1)).toBe(
      Date.parse(resets),
    );
    expect(capSpentUntil(resets, Date.parse(resets))).toBeNull();
    expect(capSpentUntil(resets, Date.parse(resets) + minute)).toBeNull();
  });

  it("is not spent when the list gives no time", () => {
    expect(capSpentUntil(undefined, now)).toBeNull();
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
