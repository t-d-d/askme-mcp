import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ModelFailed,
  type Model,
  type ModelRequest,
} from "../service/src/model";
import { rateWaitMs, rateWaits, retryingOnRate } from "./model";

// A model that answers each call with the next reply in the list, a thrown
// error included, and keeps the time of every call it was sent.
function fakeModel(replies: unknown[]) {
  const sentAt: number[] = [];
  const model: Model = {
    reply() {
      sentAt.push(performance.now());
      const next = replies.shift();
      return next instanceof Error
        ? Promise.reject(next)
        : Promise.resolve(next);
    },
  };
  return { model, sentAt };
}

const request: ModelRequest = {
  system: "Sort the ask.",
  user: "An ask.",
  schemaName: "sort",
  schema: {},
  maxTokens: 300,
  timeoutMs: 20_000,
};

const refused = () => new ModelFailed("status-429");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "performance"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a call the provider refuses for rate (#303)", () => {
  it("is sent again after the first wait, and its reply comes back", async () => {
    const { model, sentAt } = fakeModel([refused(), { level: "high" }]);
    const reply = retryingOnRate(model).reply(request);
    await vi.advanceTimersByTimeAsync((rateWaits[0]?.least ?? 0) - 1);
    expect(sentAt).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(
      (rateWaits[0]?.most ?? 0) - (rateWaits[0]?.least ?? 0) + 1,
    );
    await expect(reply).resolves.toEqual({ level: "high" });
    expect(sentAt).toHaveLength(2);
  });

  it("is sent again once after each wait, then counts as refused", async () => {
    const { model, sentAt } = fakeModel(
      Array.from({ length: rateWaits.length + 2 }, refused),
    );
    const reply = retryingOnRate(model).reply(request);
    const failure = expect(reply).rejects.toMatchObject({
      reason: "status-429",
    });
    await vi.advanceTimersByTimeAsync(rateWaitMs);
    await failure;
    expect(sentAt).toHaveLength(rateWaits.length + 1);
    sentAt.slice(1).forEach((at, n) => {
      const waited = at - (sentAt[n] ?? 0);
      expect(waited).toBeGreaterThanOrEqual(rateWaits[n]?.least ?? 0);
      expect(waited).toBeLessThanOrEqual(rateWaits[n]?.most ?? 0);
    });
  });
});

describe("calls the provider refuses for rate at the same moment (#312)", () => {
  it("are not all sent again at the same moment", async () => {
    const calls = Array.from({ length: 5 }, () =>
      fakeModel([refused(), { level: "high" }]),
    );
    const replies = calls.map(({ model }) =>
      retryingOnRate(model).reply(request),
    );
    await vi.advanceTimersByTimeAsync(rateWaits[0]?.most ?? 0);
    await Promise.all(replies);
    const sentAgainAt = new Set(calls.map(({ sentAt }) => sentAt[1]));
    expect(sentAgainAt.size).toBeGreaterThan(1);
  });
});

describe("each wait before a new try (#312)", () => {
  it("is at its most when the random part is at its top, and rateWaitMs covers every wait at its most", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1 - Number.EPSILON);
    const { model, sentAt } = fakeModel(
      Array.from({ length: rateWaits.length + 1 }, refused),
    );
    const reply = retryingOnRate(model).reply(request);
    const failure = expect(reply).rejects.toMatchObject({
      reason: "status-429",
    });
    await vi.advanceTimersByTimeAsync(rateWaitMs);
    await failure;
    expect(sentAt.slice(1).map((at, n) => at - (sentAt[n] ?? 0))).toEqual(
      rateWaits.map(({ most }) => most),
    );
  });

  it("is at its least when the random part is nothing", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { model, sentAt } = fakeModel(
      Array.from({ length: rateWaits.length + 1 }, refused),
    );
    const reply = retryingOnRate(model).reply(request);
    const failure = expect(reply).rejects.toMatchObject({
      reason: "status-429",
    });
    await vi.advanceTimersByTimeAsync(rateWaitMs);
    await failure;
    expect(sentAt.slice(1).map((at, n) => at - (sentAt[n] ?? 0))).toEqual(
      rateWaits.map(({ least }) => least),
    );
  });
});

describe("a call that fails for any other reason", () => {
  it("is not sent again", async () => {
    const { model, sentAt } = fakeModel([
      new ModelFailed("timeout"),
      { level: "high" },
    ]);
    const reply = retryingOnRate(model).reply(request);
    await expect(reply).rejects.toMatchObject({ reason: "timeout" });
    await vi.advanceTimersByTimeAsync(rateWaitMs);
    expect(sentAt).toHaveLength(1);
  });
});
