import { describe, expect, it } from "vitest";
import { serviceAhead } from "./load";

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
