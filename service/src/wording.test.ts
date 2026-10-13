import { describe, expect, it } from "vitest";
import { countPer, timesIn, waitFor } from "./wording";

describe("the words for a wait", () => {
  it("counts whole seconds", () => {
    expect(waitFor(12)).toBe("Wait 12 seconds");
  });

  it("says one second, not one seconds", () => {
    expect(waitFor(1)).toBe("Wait 1 second");
  });
});

describe("the words for a limit", () => {
  it("say how many times in a one-minute window", () => {
    expect(timesIn({ limit: 60, windowMinutes: 1 })).toBe(
      "60 times in a minute",
    );
  });

  it("say how many times in a longer window", () => {
    expect(timesIn({ limit: 10, windowMinutes: 5 })).toBe(
      "10 times in 5 minutes",
    );
  });

  it("say how many of a thing a minute", () => {
    expect(countPer({ limit: 30, windowMinutes: 1 }, "asks")).toBe(
      "30 asks a minute",
    );
  });

  it("say how many of a thing in a longer window", () => {
    expect(countPer({ limit: 30, windowMinutes: 5 }, "asks")).toBe(
      "30 asks in 5 minutes",
    );
  });
});
