import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  ModelFailed,
  type Model,
  type ModelRequest,
} from "../service/src/model";
import { reasonLimit } from "../service/src/sort";
import { sortMaxTokens, sortTimeoutMs } from "../service/src/sorter";
import { cases, type EvalCase } from "./cases";
import { rateWaitMs, rateWaits } from "./model";
import { evalPrompt, inPool, sortEvalAsk, sortingTimeoutMs } from "./sorting";

function fakeModel(replies: unknown[]) {
  const requests: ModelRequest[] = [];
  const model: Model = {
    reply(request) {
      requests.push(request);
      const next = replies.shift();
      return next instanceof Error
        ? Promise.reject(next)
        : Promise.resolve(next);
    },
  };
  return { model, requests };
}

const [one] = cases;
if (one === undefined) throw new Error("The eval set has no asks.");

const fits = {
  hashtags: ["work"],
  level: "high",
  reason: "It holds a release.",
};

describe("one sort of an eval ask", () => {
  it("sends the prompt the service builds, with the sorter's token cap and timeout", async () => {
    const { model, requests } = fakeModel([fits]);
    const outcome = await sortEvalAsk(model, one);
    expect(requests).toEqual([
      {
        ...evalPrompt(one),
        schemaName: "sort",
        maxTokens: sortMaxTokens,
        timeoutMs: sortTimeoutMs,
      },
    ]);
    expect(outcome).toMatchObject({
      one,
      sort: {
        hashtags: ["work"],
        level: "high",
        reason: "It holds a release.",
      },
      followedUp: false,
    });
  });

  it("sends a draft's instructions in place of the prompt's, with the same ask", async () => {
    const { model, requests } = fakeModel([fits]);
    await sortEvalAsk(model, one, "A draft wording.");
    expect(requests[0]?.system).toBe("A draft wording.");
    expect(requests[0]?.user).toBe(evalPrompt(one).user);
  });

  it("sends a reply whose only fault is a long reason back, and keeps the next reply", async () => {
    const long = { ...fits, reason: "x".repeat(reasonLimit + 1) };
    const { model, requests } = fakeModel([long, fits]);
    const outcome = await sortEvalAsk(model, one);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.followUp?.reply).toBe(JSON.stringify(long));
    expect(outcome).toMatchObject({
      sort: { reason: fits.reason },
      followedUp: true,
    });
  });

  it("sorts an ask that has rules of its own under them, and takes their hashtags", async () => {
    const ruled: EvalCase = {
      ...one,
      group: "rules",
      rules: {
        text: "#garden is the allotment. It's top priority.",
        hashtags: ["garden"],
      },
    };
    const reply = { hashtags: ["garden"], level: "high", reason: "Top." };
    const long = { ...reply, reason: "x".repeat(reasonLimit + 1) };
    const { model, requests } = fakeModel([long, reply]);
    const outcome = await sortEvalAsk(model, ruled);
    expect(requests[0]?.user).toContain("#garden is the allotment");
    expect(requests[0]?.user).not.toContain("#work");
    expect(requests).toHaveLength(2);
    expect(outcome.sort).toEqual(reply);
  });

  it("counts a reply that does not fit as no fitting reply", async () => {
    const { model } = fakeModel([{ ...fits, level: "critical" }]);
    const outcome = await sortEvalAsk(model, one);
    expect(outcome.sort).toBeUndefined();
    expect(outcome.failure).toBe("reply-rejected");
  });

  it("scores a reply that came after a 429 like any other, with no wait in its time", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "performance"] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const { model, requests } = fakeModel([
      new ModelFailed("status-429"),
      fits,
    ]);
    const sorted = sortEvalAsk(model, one);
    await vi.advanceTimersByTimeAsync(rateWaits[0]?.most ?? 0);
    const outcome = await sorted;
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(outcome).toEqual({
      one,
      sort: {
        hashtags: ["work"],
        level: "high",
        reason: "It holds a release.",
      },
      ms: 0,
      followedUp: false,
    });
  });

  it("records a model that gave no reply by its reason", async () => {
    const { model } = fakeModel([new ModelFailed("timeout")]);
    const outcome = await sortEvalAsk(model, one);
    expect(outcome).toMatchObject({ one, failure: "timeout" });
  });
});

describe("a pool of tasks", () => {
  it("runs every item once, and keeps their order", async () => {
    const done = await inPool([1, 2, 3, 4, 5], 2, (n) =>
      Promise.resolve(n * 10),
    );
    expect(done).toEqual([10, 20, 30, 40, 50]);
  });

  it("runs no more than the given number at once", async () => {
    let running = 0;
    let most = 0;
    await inPool([1, 2, 3, 4, 5, 6], 3, async () => {
      running++;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
    });
    expect(most).toBe(3);
  });
});

describe("the time limit for sorting asks", () => {
  it("covers every sort timing out, with its follow-up, each call after waiting out every 429", () => {
    // 96 sorts, 5 at once: 20 turns, each up to two calls.
    expect(sortingTimeoutMs(96, 5)).toBeGreaterThanOrEqual(
      20 * 2 * (sortTimeoutMs + rateWaitMs),
    );
  });
});
