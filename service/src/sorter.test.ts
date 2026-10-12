import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { captureLogs } from "../../test/logs";
import { callerOf, type AccountId } from "./identity";
import { createLogger } from "./log";
import { ModelFailed, type Model, type ModelRequest } from "./model";
import type { NewSort, StoredAsk, AccountRules } from "./store/store";
import {
  emptyRulesSort,
  runJob,
  sortAsk,
  sortAttempts,
  sortDeliveries,
  sortMaxTokens,
  sortTimeoutMs,
  type SortContext,
} from "./sorter";

const accountId = (sub: string): AccountId =>
  callerOf({
    token: "test",
    clientId: "test",
    scopes: [],
    extra: { accountId: sub, requestId: "r" },
  }).accountId;

const owner = accountId("user_owner");

const ask: StoredAsk = {
  id: "ask_1",
  summary: "Merge the fix for checkout rounding?",
  area: "The online shop",
  spokenDetail: "The fix is ready, and the tests pass.",
  postedAt: "2026-10-11T09:30:00.000Z",
  storedAt: "2026-10-11T09:30:00.000Z",
};

const rules: AccountRules = {
  text: "#work is my day job. #shop is my online shop.",
  hashtags: ["work", "shop"],
  seen: ["work", "shop"],
  version: 4,
  readFailed: false,
};

// The parts of the store the sorter uses, in memory. It counts its reads,
// and fails each one when told to, as the table would when it is down.
function memoryStore(
  found: { ask: StoredAsk; rules: AccountRules } | undefined,
  failing = false,
) {
  const recorded: { account: AccountId; askId: string; sort: NewSort }[] = [];
  const reads = { count: 0 };
  return {
    recorded,
    reads,
    store: {
      askToSort: (account: AccountId, askId: string) => {
        expect(account).toBe(owner);
        expect(askId).toBe(ask.id);
        reads.count += 1;
        return failing
          ? Promise.reject(new TypeError("The table is down."))
          : Promise.resolve(found);
      },
      recordSort: (account: AccountId, askId: string, sort: NewSort) => {
        recorded.push({ account, askId, sort });
        return Promise.resolve(true);
      },
    },
  };
}

// A model that gives each reply in turn, and keeps what it was asked.
function memoryModel(replies: unknown[]) {
  const asked: ModelRequest[] = [];
  const model: Model = {
    reply(request) {
      asked.push(request);
      const next = replies.shift();
      return next instanceof ModelFailed
        ? Promise.reject(next)
        : Promise.resolve(next);
    },
  };
  return { model, asked };
}

const good = { hashtags: ["shop"], level: "high", reason: "Customers see it." };
const now = new Date("2026-10-11T09:31:00.000Z");

let capture: ReturnType<typeof captureLogs>;
beforeEach(() => {
  capture = captureLogs();
});
afterEach(() => {
  capture.restore();
});

// Each line the sorter logged, with its level.
const logged = () =>
  capture.lines.map(({ method, args }) => ({
    level: method,
    ...z.record(z.string(), z.unknown()).parse(args[0]),
  }));

const context = (
  memory: ReturnType<typeof memoryStore>,
  model: Model,
): SortContext => ({
  store: memory.store,
  model,
  log: createLogger("req_sort"),
  now,
});

const run = (memory: ReturnType<typeof memoryStore>, model: Model) =>
  sortAsk(owner, ask.id, context(memory, model));

describe("sorting an ask", () => {
  it("asks the model once, with the account's rules and the ask, and stores the sort with the rules version", async () => {
    const memory = memoryStore({ ask, rules });
    const { model, asked } = memoryModel([good]);
    expect(await run(memory, model)).toBe("done");
    expect(asked).toHaveLength(1);
    expect(asked[0]?.user).toContain(ask.summary);
    expect(asked[0]?.user).toContain(rules.text);
    expect(memory.recorded).toEqual([
      {
        account: owner,
        askId: ask.id,
        sort: {
          hashtags: ["shop"],
          level: "high",
          reason: "Customers see it.",
          rulesVersion: 4,
        },
      },
    ]);
    expect(logged()).toEqual([
      expect.objectContaining({
        level: "info",
        event: "ask-sorted",
        accountId: owner,
        askId: ask.id,
      }),
    ]);
  });

  // The eval sends these same two values, so its scores describe the
  // service's own call.
  it("asks the model with the token cap and timeout it exports", async () => {
    const memory = memoryStore({ ask, rules });
    const { model, asked } = memoryModel([good]);
    await run(memory, model);
    expect(asked).toEqual([
      expect.objectContaining({
        maxTokens: sortMaxTokens,
        timeoutMs: sortTimeoutMs,
      }),
    ]);
  });

  it("asks no model when the rules are empty, and lists the ask with no hashtag", async () => {
    const memory = memoryStore({
      ask,
      rules: { ...rules, text: "  ", hashtags: [] },
    });
    const { model, asked } = memoryModel([]);
    await run(memory, model);
    expect(asked).toEqual([]);
    expect(memory.recorded.map(({ sort }) => sort)).toEqual([
      { ...emptyRulesSort, rulesVersion: 4 },
    ]);
    expect(emptyRulesSort.hashtags).toEqual([]);
  });

  it("does nothing when the ask is no longer open", async () => {
    const memory = memoryStore(undefined);
    const { model, asked } = memoryModel([good]);
    await run(memory, model);
    expect(asked).toEqual([]);
    expect(memory.recorded).toEqual([]);
  });

  it("does nothing when the ask is already sorted with these rules", async () => {
    const sorted: StoredAsk = {
      ...ask,
      sort: {
        hashtags: ["work"],
        level: "low",
        reason: "Routine.",
        rulesVersion: 4,
        sortedAt: now.toISOString(),
      },
    };
    const memory = memoryStore({ ask: sorted, rules });
    const { model, asked } = memoryModel([good]);
    await run(memory, model);
    expect(asked).toEqual([]);
    expect(memory.recorded).toEqual([]);
  });

  it("tries again when a reply is discarded, and stores the next good one", async () => {
    const memory = memoryStore({ ask, rules });
    const invented = { hashtags: ["urgent"], level: "high", reason: "r" };
    const { model, asked } = memoryModel([invented, good]);
    await run(memory, model);
    expect(asked).toHaveLength(2);
    expect(memory.recorded).toHaveLength(1);
  });

  it(`leaves the ask unsorted after ${String(sortAttempts)} failed tries, and says why to the job that asked`, async () => {
    const memory = memoryStore({ ask, rules });
    const { model, asked } = memoryModel([
      new ModelFailed("status-502"),
      { hashtags: [], level: "fourth", reason: "r" },
    ]);
    expect(await run(memory, model)).toEqual({ failed: "reply-rejected" });
    expect(asked).toHaveLength(sortAttempts);
    expect(memory.recorded).toEqual([]);
    expect(logged()).toEqual([]);
  });

  it("is done when the ask is no longer open, or already sorted with these rules", async () => {
    const { model } = memoryModel([]);
    expect(await run(memoryStore(undefined), model)).toBe("done");
  });
});

describe("a job from the queue", () => {
  const job = (
    receives: number,
    body = { accountId: owner, askId: ask.id },
  ) => ({
    messageId: "message-1",
    text: JSON.stringify(body),
    receives,
  });

  // Runs one delivery of the job, and gives whether it goes back to the
  // queue to be delivered again.
  const deliver = (
    receives: number,
    memory: ReturnType<typeof memoryStore>,
    model: Model,
  ) =>
    runJob(job(receives), createLogger("req_sort"), () =>
      context(memory, model),
    );

  const failing = () =>
    memoryModel([new ModelFailed("status-503"), new ModelFailed("status-503")])
      .model;

  it("is done once the ask is sorted", async () => {
    const memory = memoryStore({ ask, rules });
    expect(await deliver(1, memory, memoryModel([good]).model)).toBe(false);
    expect(memory.recorded).toHaveLength(1);
  });

  it(`goes back to the queue when the sort fails before the delivery numbered ${String(sortDeliveries)}, logging at info`, async () => {
    for (let receives = 1; receives < sortDeliveries; receives++) {
      capture.lines.length = 0;
      expect(
        await deliver(receives, memoryStore({ ask, rules }), failing()),
      ).toBe(true);
      expect(logged()).toEqual([
        expect.objectContaining({
          level: "info",
          event: "sort-retried",
          accountId: owner,
          askId: ask.id,
          errorClass: "status-503",
        }),
      ]);
    }
  });

  it(`is let go when the sort fails on the delivery numbered ${String(sortDeliveries)}, with one warn line`, async () => {
    expect(
      await deliver(sortDeliveries, memoryStore({ ask, rules }), failing()),
    ).toBe(false);
    expect(logged()).toEqual([
      expect.objectContaining({
        level: "warn",
        event: "sort-failed",
        accountId: owner,
        askId: ask.id,
        errorClass: "status-503",
      }),
    ]);
  });

  it("is let go before any work on a later delivery, with one warn line", async () => {
    const memory = memoryStore({ ask, rules });
    const { model, asked } = memoryModel([good]);
    expect(await deliver(sortDeliveries + 1, memory, model)).toBe(false);
    expect(memory.reads.count).toBe(0);
    expect(asked).toEqual([]);
    expect(logged()).toEqual([
      expect.objectContaining({
        level: "warn",
        event: "sort-failed",
        accountId: owner,
        askId: ask.id,
        errorClass: "deliveries-spent",
      }),
    ]);
  });

  it("logs a failure of askme's own at error, and reports it to the queue the same way", async () => {
    const { model } = memoryModel([good]);
    expect(await deliver(1, memoryStore({ ask, rules }, true), model)).toBe(
      true,
    );
    expect(logged()).toEqual([
      expect.objectContaining({
        level: "error",
        event: "request-failed",
        errorClass: "TypeError",
      }),
      expect.objectContaining({ level: "info", event: "sort-retried" }),
    ]);
    capture.lines.length = 0;
    expect(
      await deliver(sortDeliveries, memoryStore({ ask, rules }, true), model),
    ).toBe(false);
    expect(logged()).toEqual([
      expect.objectContaining({ level: "error", event: "request-failed" }),
      expect.objectContaining({
        level: "warn",
        event: "sort-failed",
        errorClass: "TypeError",
      }),
    ]);
  });

  it("lets a job it cannot read go at once, at error, since only askme sends one", async () => {
    const memory = memoryStore({ ask, rules });
    const { model } = memoryModel([good]);
    for (const text of ["not json", JSON.stringify({ askId: ask.id })]) {
      capture.lines.length = 0;
      expect(
        await runJob(
          { messageId: "message-1", text, receives: 1 },
          createLogger("req_sort"),
          () => context(memory, model),
        ),
      ).toBe(false);
      expect(logged()).toEqual([
        expect.objectContaining({ level: "error", event: "request-failed" }),
      ]);
    }
    expect(memory.reads.count).toBe(0);
  });
});
