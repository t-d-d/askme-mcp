import { afterEach, describe, expect, it, vi } from "vitest";
import type { Hashtag, TimeWindow } from "../../shared/page-api";
import { heldAsks, hoursText, isOpen, wallClock } from "./hours";

afterEach(() => {
  vi.restoreAllMocks();
});

const weekdaysOnly: TimeWindow["days"] = ["mon", "tue", "wed", "thu", "fri"];
const everyDay: TimeWindow["days"] = [...weekdaysOnly, "sat", "sun"];

// 12 October 2026 is a Monday. London is on summer time, an hour ahead of
// UTC, until 25 October.
const at = (iso: string) => Date.parse(iso);

describe("the wall clock in a time zone", () => {
  it("gives the day of the week and the minute of the day there", () => {
    expect(wallClock(at("2026-10-12T07:00:00Z"), "Europe/London")).toEqual({
      day: "mon",
      minute: 8 * 60,
    });
    expect(wallClock(at("2026-10-12T07:00:00Z"), "America/New_York")).toEqual({
      day: "mon",
      minute: 3 * 60,
    });
    expect(wallClock(at("2026-10-12T23:30:00Z"), "Asia/Tokyo")).toEqual({
      day: "tue",
      minute: 8 * 60 + 30,
    });
  });

  it("counts midnight as the first minute of the day", () => {
    expect(wallClock(at("2026-10-12T23:00:00Z"), "Europe/London")).toEqual({
      day: "tue",
      minute: 0,
    });
  });

  it("follows the clocks when they change", () => {
    // Summer time ends on 25 October, so London is on UTC again.
    expect(wallClock(at("2026-10-26T08:00:00Z"), "Europe/London")).toEqual({
      day: "mon",
      minute: 8 * 60,
    });
  });

  it("is not known in a time zone that is not one", () => {
    expect(wallClock(at("2026-10-12T07:00:00Z"), "Mars/Olympus")).toBe(
      undefined,
    );
  });

  const partsSaying = (parts: Intl.DateTimeFormatPart[]) =>
    vi
      .spyOn(Intl.DateTimeFormat.prototype, "formatToParts")
      .mockReturnValue(parts);

  it("counts an hour given as 24 as the first hour of the day", () => {
    partsSaying([
      { type: "weekday", value: "Tue" },
      { type: "literal", value: " " },
      { type: "hour", value: "24" },
      { type: "literal", value: ":" },
      { type: "minute", value: "05" },
    ]);
    expect(wallClock(at("2026-10-12T23:05:00Z"), "Europe/London")).toEqual({
      day: "tue",
      minute: 5,
    });
  });

  it("is not known when the browser gives no hour", () => {
    partsSaying([
      { type: "weekday", value: "Tue" },
      { type: "literal", value: " " },
      { type: "minute", value: "05" },
    ]);
    expect(wallClock(at("2026-10-12T23:05:00Z"), "Europe/London")).toBe(
      undefined,
    );
  });
});

describe("whether a hashtag's hours are open", () => {
  const work: TimeWindow[] = [
    { days: weekdaysOnly, from: "08:00", to: "18:00" },
  ];
  const openAt = (windows: TimeWindow[], iso: string) => {
    const clock = wallClock(at(iso), "Europe/London");
    if (clock === undefined) throw new Error("London is a time zone.");
    return isOpen(windows, clock);
  };

  it("opens at the minute a window starts, and not a moment before", () => {
    expect(openAt(work, "2026-10-12T06:59:59.999Z")).toBe(false);
    expect(openAt(work, "2026-10-12T07:00:00Z")).toBe(true);
  });

  it("closes at the minute a window ends, and not a moment before", () => {
    expect(openAt(work, "2026-10-12T16:59:59.999Z")).toBe(true);
    expect(openAt(work, "2026-10-12T17:00:00Z")).toBe(false);
  });

  it("is closed on a day the window does not open", () => {
    expect(openAt(work, "2026-10-17T11:00:00Z")).toBe(false);
  });

  it("opens at a window's local time after the clocks change", () => {
    expect(openAt(work, "2026-10-26T07:59:59.999Z")).toBe(false);
    expect(openAt(work, "2026-10-26T08:00:00Z")).toBe(true);
  });

  it("is always open with no windows: the hashtag shows at any time", () => {
    expect(openAt([], "2026-10-17T03:00:00Z")).toBe(true);
  });

  it("runs a window past midnight into the next day, from the day it opens", () => {
    const fridayNights: TimeWindow[] = [
      { days: ["fri"], from: "22:00", to: "07:00" },
    ];
    // Friday 16 October, London time.
    expect(openAt(fridayNights, "2026-10-16T20:59:59.999Z")).toBe(false);
    expect(openAt(fridayNights, "2026-10-16T21:00:00Z")).toBe(true);
    expect(openAt(fridayNights, "2026-10-16T23:00:00Z")).toBe(true);
    // Saturday morning.
    expect(openAt(fridayNights, "2026-10-17T05:59:59.999Z")).toBe(true);
    expect(openAt(fridayNights, "2026-10-17T06:00:00Z")).toBe(false);
    // Saturday night does not open, and nor does Friday morning.
    expect(openAt(fridayNights, "2026-10-17T21:30:00Z")).toBe(false);
    expect(openAt(fridayNights, "2026-10-16T03:00:00Z")).toBe(false);
  });

  it("runs a window to the end of the day when it ends at 24:00", () => {
    const evenings: TimeWindow[] = [
      { days: ["mon"], from: "18:00", to: "24:00" },
    ];
    expect(openAt(evenings, "2026-10-12T22:59:59.999Z")).toBe(true);
    expect(openAt(evenings, "2026-10-12T23:00:00Z")).toBe(false);
  });

  it("is open when any one of a hashtag's windows is", () => {
    const twice: TimeWindow[] = [
      { days: everyDay, from: "07:00", to: "09:00" },
      { days: everyDay, from: "17:00", to: "22:00" },
    ];
    expect(openAt(twice, "2026-10-12T07:00:00Z")).toBe(true);
    expect(openAt(twice, "2026-10-12T09:00:00Z")).toBe(false);
    expect(openAt(twice, "2026-10-12T16:00:00Z")).toBe(true);
  });
});

describe("the asks held back", () => {
  const hashtags: Hashtag[] = [
    { name: "shop", colour: 1 },
    {
      name: "work",
      colour: 0,
      hours: [{ days: weekdaysOnly, from: "08:00", to: "18:00" }],
    },
    {
      name: "family",
      colour: 2,
      hours: [{ days: everyDay, from: "17:00", to: "22:00" }],
    },
  ];
  const asks = [
    { id: "work", sort: { hashtags: ["work"] } },
    { id: "shop-and-work", sort: { hashtags: ["shop", "work"] } },
    { id: "shop", sort: { hashtags: ["shop"] } },
    { id: "family", sort: { hashtags: ["family"] } },
    { id: "no-hashtag", sort: { hashtags: [] } },
    { id: "not-sorted", sort: null },
    { id: "gone", sort: { hashtags: ["garden"] } },
  ];
  const held = (iso: string, timeZone?: string) =>
    [...heldAsks(asks, hashtags, timeZone, at(iso))].sort();

  it("are those with a hashtag outside its hours, a restriction winning over any other hashtag", () => {
    // Monday, 7pm in London: work has closed, and family is open.
    expect(held("2026-10-12T18:00:00Z", "Europe/London")).toEqual([
      "shop-and-work",
      "work",
    ]);
  });

  it("are counted in the time zone the rules were saved in", () => {
    // Monday, 9am in London, and 4am in New York.
    expect(held("2026-10-12T08:00:00Z", "Europe/London")).toEqual(["family"]);
    expect(held("2026-10-12T08:00:00Z", "America/New_York")).toEqual(
      ["family", "shop-and-work", "work"].sort(),
    );
  });

  it("let an ask go the minute its hours open", () => {
    expect(held("2026-10-12T06:59:59.999Z", "Europe/London")).toContain("work");
    expect(held("2026-10-12T07:00:00Z", "Europe/London")).not.toContain("work");
  });

  it("never include an ask not sorted yet, or one with no hashtag that has hours", () => {
    const now = held("2026-10-17T03:00:00Z", "Europe/London");
    expect(now).toEqual(["family", "shop-and-work", "work"].sort());
  });

  it("are none when the rules' time zone is not one, so no ask is hidden by mistake", () => {
    expect(held("2026-10-12T18:00:00Z", "Mars/Olympus")).toEqual([]);
  });
});

describe("how a hashtag's hours read", () => {
  const read = (days: TimeWindow["days"], from: string, to: string) =>
    hoursText([{ days, from, to }]);

  it("says Any time when there are none", () => {
    expect(hoursText([])).toEqual(["Any time"]);
  });

  it("names the days, then the hours, as the design's rules screen does", () => {
    expect(read(weekdaysOnly, "08:00", "18:00")).toEqual([
      "Weekdays, 8am to 6pm",
    ]);
    expect(read(everyDay, "22:00", "07:00")).toEqual([
      "Every day, 10pm to 7am",
    ]);
    expect(read(["sat", "sun"], "09:00", "12:00")).toEqual([
      "Weekends, 9am to 12pm",
    ]);
  });

  it("writes minutes only when there are some", () => {
    expect(read(weekdaysOnly, "09:00", "17:30")).toEqual([
      "Weekdays, 9am to 5:30pm",
    ]);
    expect(read(weekdaysOnly, "00:30", "12:15")).toEqual([
      "Weekdays, 12:30am to 12:15pm",
    ]);
  });

  it("says midnight at either end of the day, and all day for the whole of it", () => {
    expect(read(["mon"], "18:00", "24:00")).toEqual([
      "Mondays, 6pm to midnight",
    ]);
    expect(read(["mon"], "00:00", "06:00")).toEqual([
      "Mondays, midnight to 6am",
    ]);
    expect(read(["sat", "sun"], "00:00", "24:00")).toEqual([
      "Weekends, all day",
    ]);
  });

  it("names a run of three days or more by its ends, and other days one by one", () => {
    expect(read(["mon", "tue", "wed", "thu"], "08:00", "18:00")).toEqual([
      "Monday to Thursday, 8am to 6pm",
    ]);
    expect(read(["tue", "thu"], "08:00", "18:00")).toEqual([
      "Tuesdays and Thursdays, 8am to 6pm",
    ]);
    expect(read(["mon", "wed", "fri"], "08:00", "18:00")).toEqual([
      "Mondays, Wednesdays and Fridays, 8am to 6pm",
    ]);
    expect(read(["sat"], "09:00", "12:00")).toEqual(["Saturdays, 9am to 12pm"]);
  });

  it("gives each window its own line", () => {
    expect(
      hoursText([
        { days: weekdaysOnly, from: "18:00", to: "24:00" },
        { days: ["sat", "sun"], from: "00:00", to: "24:00" },
      ]),
    ).toEqual(["Weekdays, 6pm to midnight", "Weekends, all day"]);
  });
});
