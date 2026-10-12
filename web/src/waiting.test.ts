import { describe, expect, it } from "vitest";
import {
  age,
  inListOrder,
  lapsedAsks,
  longestWaitingFirst,
  waiting,
} from "./waiting";

const now = Date.parse("2026-10-11T12:00:00.000Z");
const ago = (ms: number) => new Date(now - ms).toISOString();
const minute = 60_000;

describe("how long an ask has waited", () => {
  it.each([
    [0, "Just now"],
    [59_000, "Just now"],
    [minute, "1 min"],
    [4 * minute, "4 min"],
    [59 * minute, "59 min"],
    [60 * minute, "1 h"],
    [23 * 60 * minute, "23 h"],
    [24 * 60 * minute, "1 d"],
    [50 * 60 * minute, "2 d"],
  ])("after %i ms is %s", (elapsed, words) => {
    expect(age(ago(elapsed), now)).toBe(words);
  });

  it("reads as just now when the clocks disagree a little", () => {
    expect(age(new Date(now + 5000).toISOString(), now)).toBe("Just now");
  });

  it("says Waiting on the top card, except just now", () => {
    expect(waiting(ago(4 * minute), now)).toBe("Waiting 4 min");
    expect(waiting(ago(0), now)).toBe("Just now");
  });
});

describe("the order of the list", () => {
  it("puts the ask that has waited longest first", () => {
    const asks = [
      { id: "b", postedAt: ago(1 * minute) },
      { id: "c", postedAt: ago(30 * minute) },
      { id: "a", postedAt: ago(5 * minute) },
    ];
    expect(longestWaitingFirst(asks).map((ask) => ask.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("keeps a steady order for asks posted at the same moment", () => {
    const at = ago(minute);
    const asks = [
      { id: "y", postedAt: at },
      { id: "x", postedAt: at },
    ];
    expect(longestWaitingFirst(asks).map((ask) => ask.id)).toEqual(["x", "y"]);
  });

  it("leaves the list it was given as it was", () => {
    const asks = [
      { id: "b", postedAt: ago(1 * minute) },
      { id: "a", postedAt: ago(5 * minute) },
    ];
    longestWaitingFirst(asks);
    expect(asks.map((ask) => ask.id)).toEqual(["b", "a"]);
  });
});

describe("the order of a sorted list", () => {
  const sorted = (level: "high" | "normal" | "low") => ({
    hashtags: [],
    level,
  });

  it("puts the higher level first, then the ask that has waited longest", () => {
    const asks = [
      {
        id: "low-old",
        postedAt: ago(60 * minute),
        opened: false,
        sort: sorted("low"),
      },
      {
        id: "high-new",
        postedAt: ago(1 * minute),
        opened: false,
        sort: sorted("high"),
      },
      {
        id: "normal",
        postedAt: ago(30 * minute),
        opened: false,
        sort: sorted("normal"),
      },
      {
        id: "high-old",
        postedAt: ago(20 * minute),
        opened: false,
        sort: sorted("high"),
      },
    ];
    expect(inListOrder(asks, now).map((ask) => ask.id)).toEqual([
      "high-old",
      "high-new",
      "normal",
      "low-old",
    ]);
  });

  it("puts asks not sorted yet after the sorted ones, longest waiting first", () => {
    const asks = [
      {
        id: "unsorted-new",
        postedAt: ago(1 * minute),
        opened: false,
        sort: null,
      },
      {
        id: "low",
        postedAt: ago(2 * minute),
        opened: false,
        sort: sorted("low"),
      },
      {
        id: "unsorted-old",
        postedAt: ago(9 * minute),
        opened: false,
        sort: null,
      },
    ];
    expect(inListOrder(asks, now).map((ask) => ask.id)).toEqual([
      "low",
      "unsorted-old",
      "unsorted-new",
    ]);
  });

  it("sinks an opened ask below the unopened ones at its level, and no further", () => {
    const asks = [
      {
        id: "high-opened",
        postedAt: ago(50 * minute),
        opened: true,
        sort: sorted("high"),
      },
      {
        id: "high",
        postedAt: ago(1 * minute),
        opened: false,
        sort: sorted("high"),
      },
      {
        id: "normal",
        postedAt: ago(40 * minute),
        opened: false,
        sort: sorted("normal"),
      },
      {
        id: "unsorted-opened",
        postedAt: ago(30 * minute),
        opened: true,
        sort: null,
      },
      { id: "unsorted", postedAt: ago(2 * minute), opened: false, sort: null },
    ];
    expect(inListOrder(asks, now).map((ask) => ask.id)).toEqual([
      "high",
      "high-opened",
      "normal",
      "unsorted",
      "unsorted-opened",
    ]);
  });

  it("keeps opened asks at one level longest waiting first", () => {
    const asks = [
      { id: "new", postedAt: ago(1 * minute), opened: true, sort: null },
      { id: "old", postedAt: ago(9 * minute), opened: true, sort: null },
    ];
    expect(inListOrder(asks, now).map((ask) => ask.id)).toEqual(["old", "new"]);
  });
});

describe("the order of the list as asks near the time they lapse", () => {
  const hour = 60 * minute;
  const lapsesIn = (ms: number) => new Date(now + ms).toISOString();
  const sorted = (level: "high" | "normal" | "low") => ({
    hashtags: [],
    level,
  });
  const ask = (
    id: string,
    waited: number,
    sort: { hashtags: string[]; level: "high" | "normal" | "low" } | null,
    lapse?: number,
    opened = false,
  ) => ({
    id,
    postedAt: ago(waited),
    opened,
    sort,
    ...(lapse === undefined ? {} : { lapsesAt: lapsesIn(lapse) }),
  });
  const order = (asks: Parameters<typeof inListOrder>[0], at = now) =>
    inListOrder(asks, at).map(({ id }) => id);

  it("puts an ask that lapses within the hour first, whatever its level, soonest first", () => {
    const asks = [
      ask("high", 50 * minute, sorted("high")),
      ask("low-in-50", 1 * minute, sorted("low"), 50 * minute),
      ask("unsorted-in-10", 2 * minute, null, 10 * minute),
      ask("normal-in-60", 30 * minute, sorted("normal"), hour),
    ];
    expect(order(asks)).toEqual([
      "unsorted-in-10",
      "low-in-50",
      "normal-in-60",
      "high",
    ]);
  });

  it("puts asks that lapse within the next day first at their level, soonest first, then the rest longest waiting first", () => {
    const asks = [
      ask("old", 3 * hour, sorted("normal")),
      ask("in-5h", 1 * minute, sorted("normal"), 5 * hour),
      ask("in-2h", 2 * minute, sorted("normal"), 2 * hour),
      ask("in-2d", 2 * hour, sorted("normal"), 48 * hour),
      ask("in-1d", 3 * minute, sorted("normal"), 24 * hour),
      ask("high", 1 * minute, sorted("high")),
      ask("low-in-2h", 4 * minute, sorted("low"), 2 * hour),
    ];
    expect(order(asks)).toEqual([
      "high",
      "in-2h",
      "in-5h",
      "in-1d",
      "old",
      "in-2d",
      "low-in-2h",
    ]);
  });

  it("does the same for asks not sorted yet", () => {
    const asks = [
      ask("old", 3 * hour, null),
      ask("in-5h", 1 * minute, null, 5 * hour),
      ask("low", 1 * minute, sorted("low")),
    ];
    expect(order(asks)).toEqual(["low", "in-5h", "old"]);
  });

  it("sinks an opened ask that lapses within the hour below the unopened ones there, and no further", () => {
    const asks = [
      ask("high", 50 * minute, sorted("high")),
      ask("opened-in-5", 1 * minute, sorted("low"), 5 * minute, true),
      ask("in-30", 2 * minute, sorted("low"), 30 * minute),
    ];
    expect(order(asks)).toEqual(["in-30", "opened-in-5", "high"]);
  });

  it("sinks an opened ask below the unopened ones at its level, and each part keeps its order", () => {
    const asks = [
      ask("opened-old", 4 * hour, sorted("normal"), undefined, true),
      ask("opened-in-2h", 1 * minute, sorted("normal"), 2 * hour, true),
      ask("old", 3 * hour, sorted("normal")),
      ask("in-5h", 2 * minute, sorted("normal"), 5 * hour),
      ask("low", 1 * minute, sorted("low")),
    ];
    expect(order(asks)).toEqual([
      "in-5h",
      "old",
      "opened-in-2h",
      "opened-old",
      "low",
    ]);
  });

  it("moves an ask up as its time comes near", () => {
    const asks = [
      ask("high", 50 * minute, sorted("high")),
      ask("old", 3 * hour, sorted("low")),
      ask("low-in-25h", 1 * minute, sorted("low"), 25 * hour),
    ];
    expect(order(asks)).toEqual(["high", "old", "low-in-25h"]);
    expect(order(asks, now + 2 * hour)).toEqual(["high", "low-in-25h", "old"]);
    expect(order(asks, now + 24 * hour + 1)).toEqual([
      "low-in-25h",
      "high",
      "old",
    ]);
  });

  it("puts lapsed asks after every other, longest waiting first, with opened ones last", () => {
    const asks = [
      // Lapsed earlier, but has waited less.
      ask("lapsed-new", 10 * minute, sorted("high"), -5 * minute),
      ask("lapsed-opened", 5 * hour, sorted("high"), -hour, true),
      ask("unsorted", 1 * minute, null),
      ask("lapsed-old", 2 * hour, sorted("low"), -minute),
    ];
    expect(order(asks)).toEqual([
      "unsorted",
      "lapsed-old",
      "lapsed-new",
      "lapsed-opened",
    ]);
  });
});

describe("the asks that have lapsed", () => {
  const ask = (id: string, lapse?: number) => ({
    id,
    ...(lapse === undefined
      ? {}
      : { lapsesAt: new Date(now + lapse).toISOString() }),
  });

  it("is the asks whose time has passed, from the moment it comes", () => {
    const asks = [
      ask("passed", -1),
      ask("now", 0),
      ask("soon", 1),
      ask("never"),
    ];
    expect([...lapsedAsks(asks, now)].sort()).toEqual(["now", "passed"]);
  });

  it("follows the clock", () => {
    const asks = [ask("in-an-hour", 60 * minute)];
    expect(lapsedAsks(asks, now).size).toBe(0);
    expect([...lapsedAsks(asks, now + 60 * minute)]).toEqual(["in-an-hour"]);
  });
});
