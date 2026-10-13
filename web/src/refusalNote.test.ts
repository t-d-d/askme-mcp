import { describe, expect, it } from "vitest";
import { Refusal } from "./load";
import { refusalNote } from "./refusalNote";

const at = (iso: string) => Date.parse(iso);
const minute = 60 * 1000;

describe("the note a refused press gives", () => {
  it("says the daily cap is reached and when it resets, in the time zone", () => {
    const sent = at("2026-10-12T15:00:00Z");
    const capped = new Refusal("cap_reached", "Out of sorts.");
    expect(refusalNote(capped, sent, "Europe/London")).toEqual({
      kind: "cap",
      words: "You've reached today's limit. It resets at 01:00.",
      goesAt: at("2026-10-13T00:00:00Z"),
    });
    expect(refusalNote(capped, sent, "America/New_York").words).toBe(
      "You've reached today's limit. It resets at 20:00.",
    );
  });

  // The service refuses at 23:58 UTC by its own clock.
  it("goes when the service's day ends, on a clock a few minutes fast", () => {
    const sent = at("2026-10-13T00:01:00Z");
    const note = refusalNote(
      new Refusal("cap_reached", "Out of sorts.", -3 * minute),
      sent,
      "Europe/London",
    );
    expect(note).toEqual({
      kind: "cap",
      words: "You've reached today's limit. It resets at 01:00.",
      goesAt: at("2026-10-13T00:03:00Z"),
    });
  });

  it("goes when the service's day ends, on a clock a few minutes slow", () => {
    const sent = at("2026-10-12T23:55:00Z");
    const note = refusalNote(
      new Refusal("cap_reached", "Out of sorts.", 3 * minute),
      sent,
      "Europe/London",
    );
    expect(note).toEqual({
      kind: "cap",
      words: "You've reached today's limit. It resets at 01:00.",
      goesAt: at("2026-10-12T23:57:00Z"),
    });
  });

  // A clock three minutes slow still reads 24 October when the service's 25
  // October has begun, so the cap resets at midnight UTC on the 26th.
  it("gives the reset by the service's day, on a clock a few minutes slow, as the clocks change", () => {
    const note = refusalNote(
      new Refusal("cap_reached", "Out of sorts.", 3 * minute),
      at("2026-10-24T23:58:00Z"),
      "Europe/London",
    );
    expect(note.words).toBe(
      "You've reached today's limit. It resets at 00:00.",
    );
    expect(note.goesAt).toBe(at("2026-10-25T23:57:00Z"));
  });

  it("says to slow down at the rate limit, and does not go by itself", () => {
    expect(
      refusalNote(
        new Refusal("rate_limited", "Too many."),
        at("2026-10-12T15:00:00Z"),
      ),
    ).toEqual({
      kind: "rate",
      words: "Slow down a little. Try again in a few seconds.",
    });
  });

  it("says the press did not go through for any other refusal or failure", () => {
    const sent = at("2026-10-12T15:00:00Z");
    const failed = {
      kind: "failed",
      words: "That didn't go through.",
    };
    expect(
      refusalNote(new Refusal("service_unavailable", "Down.", minute), sent),
    ).toEqual(failed);
    expect(refusalNote(new Error("Network down."), sent)).toEqual(failed);
  });
});
