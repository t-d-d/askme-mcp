import { describe, expect, it } from "vitest";
import { age, inListOrder, longestWaitingFirst, waiting } from "./waiting";

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
    expect(inListOrder(asks).map((ask) => ask.id)).toEqual([
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
    expect(inListOrder(asks).map((ask) => ask.id)).toEqual([
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
    expect(inListOrder(asks).map((ask) => ask.id)).toEqual([
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
    expect(inListOrder(asks).map((ask) => ask.id)).toEqual(["old", "new"]);
  });
});
