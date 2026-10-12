import { describe, expect, it } from "vitest";
import { resetTime } from "./resets";

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
