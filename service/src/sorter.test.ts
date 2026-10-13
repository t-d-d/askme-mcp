import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { captureLogs } from "../../test/logs";
import { callerOf, type AccountId } from "./identity";
import { createLogger } from "./log";
import { CapReached, ModelFailed, type ModelRequest } from "./model";
import { parseSortReply, reasonAsked, reasonLimit } from "./sort";
import type { NewSort, StoredAsk, AccountRules } from "./store/store";
import {
  emptyRulesSort,
  handler,
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

// A model that gives each reply in turn, and keeps what it was asked. A
// failure in the list, of the model or at the cap, is thrown in its turn.
// Every call is made for the owner's account.
function memoryModel(replies: unknown[]) {
  const asked: ModelRequest[] = [];
  const model: SortContext["model"] = {
    forAccount: (account) => {
      expect(account).toBe(owner);
      return {
        reply(request) {
          asked.push(request);
          const next = replies.shift();
          return next instanceof Error
            ? Promise.reject(next)
            : Promise.resolve(next);
        },
      };
    },
  };
  return { model, asked };
}

// The cap refusing a call, as the counted model does, having sent nothing.
const capped = () => new CapReached(new Date("2026-10-12T00:00:00.000Z"));

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
  model: SortContext["model"],
): SortContext => ({
  store: memory.store,
  model,
  log: createLogger("req_sort"),
  now,
});

const run = (
  memory: ReturnType<typeof memoryStore>,
  model: SortContext["model"],
) => sortAsk(owner, ask.id, context(memory, model));

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

  // The eval sends these same three values, so its scores describe the
  // service's own call.
  it("asks the model with the schema's name, and the token cap and timeout it exports", async () => {
    const memory = memoryStore({ ask, rules });
    const { model, asked } = memoryModel([good]);
    await run(memory, model);
    expect(asked).toEqual([
      expect.objectContaining({
        schemaName: "sort",
        maxTokens: sortMaxTokens,
        timeoutMs: sortTimeoutMs,
      }),
    ]);
  });

  it("logs nothing when the store keeps no sort, as the ask closed meanwhile, and is done", async () => {
    const memory = memoryStore({ ask, rules });
    memory.store.recordSort = () => Promise.resolve(false);
    expect(await run(memory, memoryModel([good]).model)).toBe("done");
    expect(logged()).toEqual([]);
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

  it("gives the ask a level and a one-line reason when the rules are empty, as a model's reply with no hashtags would", () => {
    const { level, reason } = emptyRulesSort;
    expect(parseSortReply({ level, reason }, [])).toEqual(emptyRulesSort);
  });

  it("does nothing when the ask is no longer open, and is done", async () => {
    const memory = memoryStore(undefined);
    const { model, asked } = memoryModel([good]);
    expect(await run(memory, model)).toBe("done");
    expect(asked).toEqual([]);
    expect(memory.recorded).toEqual([]);
  });

  // The ask, sorted with the given version of the rules.
  const sortedWith = (rulesVersion: number): StoredAsk => ({
    ...ask,
    sort: {
      hashtags: ["work"],
      level: "low",
      reason: "Routine.",
      rulesVersion,
      sortedAt: now.toISOString(),
    },
  });

  it.each([
    ["the rules in force", rules.version],
    ["a newer version than the one it read", rules.version + 1],
  ])(
    "does nothing when the ask is already sorted with %s, and is done",
    async (_, version) => {
      const memory = memoryStore({ ask: sortedWith(version), rules });
      const { model, asked } = memoryModel([good]);
      expect(await run(memory, model)).toBe("done");
      expect(asked).toEqual([]);
      expect(memory.recorded).toEqual([]);
    },
  );

  it("tries again when a reply is discarded, and stores the next good one", async () => {
    const memory = memoryStore({ ask, rules });
    const invented = { hashtags: ["urgent"], level: "high", reason: "r" };
    const { model, asked } = memoryModel([invented, good]);
    await run(memory, model);
    expect(asked).toHaveLength(2);
    expect(memory.recorded).toHaveLength(1);
  });

  // #243: a reply that fits but for its reason's length goes back to the
  // model, which is asked for the whole reply again with a shorter reason.
  const long = {
    hashtags: ["work"],
    level: "low",
    reason: "x".repeat(reasonLimit + 1),
  };

  it("sends a reply whose only fault is a long reason back to the model, asks for a shorter one, and stores only the second reply", async () => {
    const memory = memoryStore({ ask, rules });
    const { model, asked } = memoryModel([long, good]);
    expect(await run(memory, model)).toBe("done");
    expect(asked).toHaveLength(2);
    const [first, second] = asked;
    expect(first).not.toHaveProperty("followUp");
    expect(second).toStrictEqual({
      ...first,
      followUp: {
        reply: JSON.stringify(long),
        user: expect.stringMatching(
          new RegExp(
            `has ${String(reasonLimit + 1)} characters.* at most ${String(reasonAsked)} characters`,
            "u",
          ),
        ) as unknown,
      },
    });
    expect(memory.recorded.map(({ sort }) => sort)).toEqual([
      {
        hashtags: ["shop"],
        level: "high",
        reason: "Customers see it.",
        rulesVersion: 4,
      },
    ]);
  });

  it("leaves the ask unsorted when the reply to the follow-up does not fit either", async () => {
    const memory = memoryStore({ ask, rules });
    const { model, asked } = memoryModel([long, long]);
    expect(await run(memory, model)).toEqual({ failed: "reply-rejected" });
    expect(asked).toHaveLength(sortAttempts);
    expect(memory.recorded).toEqual([]);
  });

  it.each([
    ["an invented hashtag", { ...good, hashtags: ["urgent"] }],
    ["a long reason and a fourth level", { ...long, level: "critical" }],
    ["a long reason of two lines", { ...long, reason: `a\n${long.reason}` }],
    ["a model failure", new ModelFailed("status-502")],
  ])("gives %s a plain second try with the first prompt", async (_, first) => {
    const memory = memoryStore({ ask, rules });
    const { model, asked } = memoryModel([first, good]);
    expect(await run(memory, model)).toBe("done");
    expect(asked).toHaveLength(2);
    expect(asked[1]).toStrictEqual(asked[0]);
    expect(asked[1]).not.toHaveProperty("followUp");
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

  it("stores nothing when the cap refuses the call, and says so to the job that asked", async () => {
    const memory = memoryStore({ ask, rules });
    const { model, asked } = memoryModel([capped()]);
    expect(await run(memory, model)).toEqual({ capped: true });
    expect(asked).toHaveLength(1);
    expect(memory.recorded).toEqual([]);
    expect(logged()).toEqual([]);
  });

  it("tries no more once the cap refuses, and says why the try before it failed", async () => {
    const memory = memoryStore({ ask, rules });
    const { model, asked } = memoryModel([
      new ModelFailed("status-502"),
      capped(),
    ]);
    expect(await run(memory, model)).toEqual({
      capped: true,
      failed: "status-502",
    });
    expect(asked).toHaveLength(sortAttempts);
    expect(memory.recorded).toEqual([]);
  });

  it("tries no more when a call fails for a reason that is not the model's, and passes the error on to the job", async () => {
    const memory = memoryStore({ ask, rules });
    const { model, asked } = memoryModel([
      new TypeError("The key could not be read."),
      good,
    ]);
    await expect(run(memory, model)).rejects.toThrow(TypeError);
    expect(asked).toHaveLength(1);
    expect(memory.recorded).toEqual([]);
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
    model: SortContext["model"],
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

  it("is let go at the cap on any delivery, with one info line, since the cap is working as designed", async () => {
    for (const receives of [1, sortDeliveries]) {
      capture.lines.length = 0;
      const memory = memoryStore({ ask, rules });
      expect(
        await deliver(receives, memory, memoryModel([capped()]).model),
      ).toBe(false);
      expect(memory.recorded).toEqual([]);
      expect(logged()).toEqual([
        expect.objectContaining({
          level: "info",
          event: "sort-capped",
          accountId: owner,
          askId: ask.id,
        }),
      ]);
    }
  });

  it("still logs a model failure on the try before the cap at warn, as the job is let go", async () => {
    expect(
      await deliver(
        1,
        memoryStore({ ask, rules }),
        memoryModel([new ModelFailed("status-503"), capped()]).model,
      ),
    ).toBe(false);
    expect(logged()).toEqual([
      expect.objectContaining({
        level: "warn",
        event: "sort-failed",
        accountId: owner,
        askId: ask.id,
        errorClass: "status-503",
      }),
      expect.objectContaining({
        level: "info",
        event: "sort-capped",
        accountId: owner,
        askId: ask.id,
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
        expect.objectContaining({
          level: "error",
          event: "request-failed",
          errorClass: "UnreadableJob",
        }),
      ]);
    }
    expect(memory.reads.count).toBe(0);
  });
});

describe("a run of the sort function", () => {
  // A record as the queue's trigger gives one, with a receive count and a
  // body no job can be read from, so no run reaches the services.
  const record = (receives: string) => ({
    messageId: "message-1",
    body: "not json",
    attributes: { ApproximateReceiveCount: receives },
  });

  it.each([
    ["no event", undefined],
    ["no records", {}],
    [
      "a receive count that is not a whole number",
      { Records: [record("1 1")] },
    ],
  ])(
    "lets an event with %s go at once, at error, since only the trigger sends one",
    async (_, event) => {
      expect(await handler(event, { awsRequestId: "sort-7" })).toEqual({
        batchItemFailures: [],
      });
      expect(logged()).toEqual([
        {
          level: "error",
          event: "request-failed",
          requestId: "sort-7",
          errorClass: "UnreadableEvent",
        },
      ]);
    },
  );

  it.each([
    ["the run's request id", { awsRequestId: "sort-7" }, "sort-7"],
    ["unknown with no context", undefined, "unknown"],
    ["unknown for an id with a space", { awsRequestId: "sort 7" }, "unknown"],
  ])("logs under %s", async (_, context, requestId) => {
    await handler({ Records: [record("1")] }, context);
    expect(logged()).toEqual([
      expect.objectContaining({ errorClass: "UnreadableJob", requestId }),
    ]);
  });
});
