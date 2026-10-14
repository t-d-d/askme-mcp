import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { noon, startClockAt } from "./clock";

describe("a started clock", () => {
  // A save takes a few round trips, which a fast runner can finish inside one
  // step of a coarser clock.
  it("gives each of several calls a few milliseconds apart a moment of its own", async () => {
    startClockAt(noon);
    const moments = [Date.now()];
    for (let call = 1; call < 10; call += 1) {
      await sleep(2);
      moments.push(Date.now());
    }
    expect(new Set(moments).size).toBe(moments.length);
  });
});
