import { describe, expect, it } from "vitest";
import { modelCallLimit, secondsLeft, windowOf } from "./rate";

const at = (time: string) => new Date(time);

describe("a rate window", () => {
  it("is named by the minute it starts, and ends at the next", () => {
    expect(windowOf(at("2026-10-11T09:30:10.000Z"), 1)).toEqual({
      name: "2026-10-11T09:30",
      endsAt: Date.parse("2026-10-11T09:31:00.000Z"),
    });
  });

  it("holds every moment of its minute, and no other", () => {
    expect(windowOf(at("2026-10-11T09:30:00.000Z"), 1).name).toBe(
      "2026-10-11T09:30",
    );
    expect(windowOf(at("2026-10-11T09:30:59.999Z"), 1).name).toBe(
      "2026-10-11T09:30",
    );
    expect(windowOf(at("2026-10-11T09:31:00.000Z"), 1).name).toBe(
      "2026-10-11T09:31",
    );
  });

  it("can span several minutes", () => {
    expect(windowOf(at("2026-10-11T09:34:10.000Z"), 5)).toEqual({
      name: "2026-10-11T09:30",
      endsAt: Date.parse("2026-10-11T09:35:00.000Z"),
    });
  });

  it("counts model calls in a UTC day, from one midnight to the next", () => {
    for (const time of [
      "2026-10-12T00:00:00.000Z",
      "2026-10-12T23:59:59.999Z",
    ]) {
      expect(windowOf(at(time), modelCallLimit.windowMinutes)).toEqual({
        name: "2026-10-12T00:00",
        endsAt: Date.parse("2026-10-13T00:00:00.000Z"),
      });
    }
  });

  it("counts the whole seconds left, rounding up", () => {
    const window = windowOf(at("2026-10-11T09:30:10.000Z"), 1);
    expect(secondsLeft(window, at("2026-10-11T09:30:10.000Z"))).toBe(50);
    expect(secondsLeft(window, at("2026-10-11T09:30:10.500Z"))).toBe(50);
    expect(secondsLeft(window, at("2026-10-11T09:30:59.900Z"))).toBe(1);
  });
});
