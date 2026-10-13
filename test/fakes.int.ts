import { describe, expect, it } from "vitest";
import { expectRepliesUsed, fakes } from "./fakes";

const callModel = async (): Promise<number> =>
  (
    await fetch(`${fakes.model.endpoint}/chat/completions`, {
      method: "POST",
      body: "{}",
    })
  ).status;

// The tests run in order, and the second sees what the first left.
describe("the fake model between tests", () => {
  it("records a call and takes a queued reply", async () => {
    fakes.model.reply({ status: 429 });
    expect(await callModel()).toBe(429);
    expect(fakes.model.calls).toHaveLength(1);
  });

  it("starts the next test with no recorded calls", () => {
    expect(fakes.model.calls).toEqual([]);
  });
});

describe("resetting the fake model", () => {
  it("drops the queued replies and the recorded calls", async () => {
    fakes.model.reply({ status: 429 }, { status: 402 });
    expect(await callModel()).toBe(429);
    fakes.model.reset();
    expect(fakes.model.calls).toEqual([]);
    expect(fakes.model.unused()).toBe(0);
    expect(await callModel()).toBe(503);
    fakes.model.reset();
  });
});

describe("a queued reply left unused", () => {
  it("fails the check, naming how many are left", () => {
    fakes.model.reply({ status: 429 }, { status: 402 });
    expect(() => {
      expectRepliesUsed(fakes.model);
    }).toThrow("2 queued model replies were left unused");
    fakes.model.reset();
  });

  it("passes the check when every reply was used", () => {
    expect(() => {
      expectRepliesUsed(fakes.model);
    }).not.toThrow();
  });
});
