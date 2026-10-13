import { describe, expect, it } from "vitest";
import { resetsAt, resetsHere, resetTime } from "./resets";

// 12 October 2026. London is on summer time, an hour ahead of UTC, until
// 1am UTC on 25 October. New York is four hours behind UTC.
const at = (iso: string) => Date.parse(iso);

describe("when a daily cap resets", () => {
  it("gives the next midnight UTC on the 24-hour clock in the time zone", () => {
    const afternoon = at("2026-10-12T15:00:00Z");
    expect(resetTime(afternoon, "UTC")).toBe("00:00");
    expect(resetTime(afternoon, "Europe/London")).toBe("01:00");
    expect(resetTime(afternoon, "Asia/Tokyo")).toBe("09:00");
    expect(resetTime(afternoon, "Asia/Kolkata")).toBe("05:30");
    // West of UTC the cap resets the same evening.
    expect(resetTime(afternoon, "America/New_York")).toBe("20:00");
  });

  it("writes midnight in the time zone as 00:00", () => {
    expect(resetTime(at("2026-12-01T10:00:00Z"), "Europe/London")).toBe(
      "00:00",
    );
  });

  it("follows the clocks when they change", () => {
    // Midnight UTC on 25 October is still summer time in London. The next
    // one is not.
    expect(resetTime(at("2026-10-24T12:00:00Z"), "Europe/London")).toBe(
      "01:00",
    );
    expect(resetTime(at("2026-10-25T12:00:00Z"), "Europe/London")).toBe(
      "00:00",
    );
  });

  it("gives the midnight after, at midnight UTC itself", () => {
    // The cap reset just now, so the next reset is a day on, after the
    // clocks have gone back.
    expect(resetTime(at("2026-10-25T00:00:00Z"), "Europe/London")).toBe(
      "00:00",
    );
  });

  it("gives the time in UTC in a time zone this browser does not know", () => {
    expect(resetTime(at("2026-10-12T15:00:00Z"), "Nowhere/At_All")).toBe(
      "00:00",
    );
  });
});

describe("the moment a daily cap resets", () => {
  it("is the next midnight UTC", () => {
    expect(resetsAt(at("2026-10-12T15:00:00Z"))).toBe(
      at("2026-10-13T00:00:00Z"),
    );
    expect(resetsAt(at("2026-10-12T23:59:59.999Z"))).toBe(
      at("2026-10-13T00:00:00Z"),
    );
  });

  it("is a day on, at midnight UTC itself", () => {
    expect(resetsAt(at("2026-10-13T00:00:00Z"))).toBe(
      at("2026-10-14T00:00:00Z"),
    );
  });
});

// The service counts every daily cap by its own clock. Here the true time
// is 23:58 UTC on 12 October, two minutes before the cap resets.
describe("the moment a daily cap resets, on this browser's clock", () => {
  const minutes = (count: number) => count * 60 * 1000;

  it("is the next midnight UTC when the two clocks agree", () => {
    expect(resetsHere(at("2026-10-12T23:58:00Z"), 0)).toBe(
      at("2026-10-13T00:00:00Z"),
    );
  });

  // This browser's clock reads 00:01 on 13 October. Its own next midnight
  // is a day away, but the service's is two minutes away, which this
  // clock reads as 00:03.
  it("is the service's next midnight on a clock a few minutes fast", () => {
    expect(resetsHere(at("2026-10-13T00:01:00Z"), -minutes(3))).toBe(
      at("2026-10-13T00:03:00Z"),
    );
  });

  // This browser's clock reads 23:55, and the service's midnight is two
  // minutes away, which this clock reads as 23:57.
  it("is the service's next midnight on a clock a few minutes slow", () => {
    expect(resetsHere(at("2026-10-12T23:55:00Z"), minutes(3))).toBe(
      at("2026-10-12T23:57:00Z"),
    );
  });
});
