import { describe, expect, it } from "vitest";
import { z } from "zod";
import { callerOf, type AccountId } from "./identity";
import {
  CapReached,
  createCountedModel,
  createModel,
  ModelFailed,
  type CallCounter,
  type ModelRequest,
} from "./model";

interface Sent {
  url: string;
  headers: Headers;
  body: unknown;
}

function fakeFetch(answer: () => Response) {
  const sent: Sent[] = [];
  const fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input, init);
    sent.push({
      url: request.url,
      headers: request.headers,
      body: JSON.parse(await request.text()) as unknown,
    });
    return answer();
  };
  return { fetch, sent };
}

const completion = (content: string | null) =>
  Response.json({
    id: "gen-test",
    object: "chat.completion",
    model: "anthropic/claude-haiku-5.5",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content },
      },
    ],
    usage: { prompt_tokens: 300, completion_tokens: 30, total_tokens: 330 },
  });

const request: ModelRequest = {
  system: "Sort it.",
  user: "<rules>\n#work\n</rules>",
  schemaName: "sort",
  schema: {
    type: "object",
    properties: { level: { type: "string" } },
    required: ["level"],
    additionalProperties: false,
  },
  maxTokens: 200,
  timeoutMs: 1000,
};

const model = (
  fetch: ReturnType<typeof fakeFetch>["fetch"],
  key: () => Promise<string | undefined> = () =>
    Promise.resolve("test-model-key"),
) =>
  createModel({
    endpoint: "http://127.0.0.1:9/api/v1",
    model: "anthropic/claude-haiku-5.5",
    key,
    fetch,
  });

describe("a call to the model", () => {
  it("sends one chat completion with the schema, no tools, no temperature, reasoning off, and providers that keep no prompts", async () => {
    const fake = fakeFetch(() => completion('{"level":"high"}'));
    await model(fake.fetch).reply(request);
    expect(fake.sent).toHaveLength(1);
    const [sent] = fake.sent;
    expect(sent?.url).toBe("http://127.0.0.1:9/api/v1/chat/completions");
    expect(sent?.headers.get("authorization")).toBe("Bearer test-model-key");
    expect(sent?.headers.get("content-type")).toBe("application/json");
    expect(sent?.body).toEqual({
      model: "anthropic/claude-haiku-5.5",
      messages: [
        { role: "system", content: "Sort it." },
        { role: "user", content: "<rules>\n#work\n</rules>" },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "sort", strict: true, schema: request.schema },
      },
      provider: {
        data_collection: "deny",
        zdr: true,
        require_parameters: true,
      },
      reasoning: { enabled: false },
      max_tokens: 200,
    });
  });

  it("sends a follow-up after the same system and user messages, with the model's earlier reply as its own message, and changes nothing else", async () => {
    const plain = fakeFetch(() => completion('{"level":"high"}'));
    await model(plain.fetch).reply(request);
    const fake = fakeFetch(() => completion('{"level":"high"}'));
    await model(fake.fetch).reply({
      ...request,
      followUp: { reply: '{"level":"low"}', user: "Shorter, please." },
    });
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]?.body).toEqual({
      ...z.record(z.string(), z.unknown()).parse(plain.sent[0]?.body),
      messages: [
        { role: "system", content: "Sort it." },
        { role: "user", content: "<rules>\n#work\n</rules>" },
        { role: "assistant", content: '{"level":"low"}' },
        { role: "user", content: "Shorter, please." },
      ],
    });
  });

  it("sends no key when it has none, as in a cloud session", async () => {
    const fake = fakeFetch(() => completion('{"level":"high"}'));
    await model(fake.fetch, () => Promise.resolve(undefined)).reply(request);
    expect(fake.sent[0]?.headers.has("authorization")).toBe(false);
  });

  it("gives the reply's JSON, unchecked, for its caller to parse", async () => {
    const fake = fakeFetch(() => completion('{"level":"high","extra":1}'));
    expect(await model(fake.fetch).reply(request)).toEqual({
      level: "high",
      extra: 1,
    });
  });

  it.each([
    [
      "a server error",
      () => new Response("down", { status: 502 }),
      "status-502",
    ],
    [
      "a refusal of the key",
      () => new Response("no", { status: 401 }),
      "status-401",
    ],
    ["a reply that is not JSON", () => completion("high"), "reply-not-json"],
    ["a reply with no content", () => completion(null), "reply-unreadable"],
    [
      "an answer of another shape",
      () => Response.json({ error: "x" }),
      "reply-unreadable",
    ],
  ])("fails with a reason on %s", async (_, answer, reason) => {
    const fake = fakeFetch(answer);
    const failure = await model(fake.fetch)
      .reply(request)
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(failure).toBeInstanceOf(ModelFailed);
    expect(z.object({ reason: z.string() }).parse(failure).reason).toBe(reason);
  });

  it("fails with a reason when the model takes too long", async () => {
    const slow = async (_: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const reason: unknown = init.signal?.reason;
          reject(reason instanceof Error ? reason : new Error("aborted"));
        });
      });
    const failure = await createModel({
      endpoint: "http://127.0.0.1:9/api/v1",
      model: "anthropic/claude-haiku-5.5",
      key: () => Promise.resolve("k"),
      fetch: slow,
    })
      .reply({ ...request, timeoutMs: 10 })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(failure).toBeInstanceOf(ModelFailed);
    expect(z.object({ reason: z.string() }).parse(failure).reason).toBe(
      "timeout",
    );
  });
});

describe("the model's key, read for a call", () => {
  const keyAfter = (ms: number) => () =>
    new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve("k");
      }, ms);
    });

  const answersAfter =
    (ms: number) => async (_: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve(completion('{"level":"high"}'));
        }, ms);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          const reason: unknown = init.signal?.reason;
          reject(reason instanceof Error ? reason : new Error("aborted"));
        });
      });

  const failureOf = (call: Promise<unknown>) =>
    call.then(
      () => undefined,
      (error: unknown) => error,
    );

  const reasonOf = (failure: unknown) =>
    z.object({ reason: z.string() }).parse(failure).reason;

  it("counts against the call's time limit, and nothing is sent once that has run out", async () => {
    const fake = fakeFetch(() => completion('{"level":"high"}'));
    const failure = await failureOf(
      model(fake.fetch, keyAfter(200)).reply({ ...request, timeoutMs: 20 }),
    );
    expect(failure).toBeInstanceOf(ModelFailed);
    expect(reasonOf(failure)).toBe("timeout");
    expect(fake.sent).toEqual([]);
  });

  it("leaves the call only what is left of its time limit", async () => {
    // Each alone fits in 300ms. Together they take 350ms.
    const failure = await failureOf(
      model(answersAfter(150), keyAfter(200)).reply({
        ...request,
        timeoutMs: 300,
      }),
    );
    expect(failure).toBeInstanceOf(ModelFailed);
    expect(reasonOf(failure)).toBe("timeout");
  });

  it("is askme's own failure when it cannot be read, thrown as it came", async () => {
    const fake = fakeFetch(() => completion('{"level":"high"}'));
    const unreadable = new Error("The key could not be read.");
    const failure = await failureOf(
      model(fake.fetch, () => Promise.reject(unreadable)).reply(request),
    );
    expect(failure).toBe(unreadable);
    expect(fake.sent).toEqual([]);
  });
});

const accountId = (sub: string): AccountId =>
  callerOf({
    token: "test",
    clientId: "test",
    scopes: [],
    extra: { accountId: sub, requestId: "r" },
  }).accountId;

const owner = accountId("user_owner");

// Shares one list with the fetch, so a test can see the order of counts,
// resets and sends.
function memoryCounter(left: number, events: string[]) {
  let calls = left;
  const counter: CallCounter = {
    countCall: (account, limit) => {
      if (limit !== "modelCall") {
        return Promise.reject(new Error(`Counted against ${limit}.`));
      }
      events.push(`count ${account}`);
      if (calls <= 0) {
        return Promise.resolve({ counted: false, secondsLeft: 3600 });
      }
      calls -= 1;
      return Promise.resolve({ counted: true });
    },
    modelCapSpent: () => Promise.resolve(calls <= 0),
    recordModelCapReset: (account, resetsAt) => {
      events.push(`record ${account} ${resetsAt.toISOString()}`);
      return Promise.resolve(true);
    },
  };
  return counter;
}

function counted(left: number) {
  const events: string[] = [];
  const fake = fakeFetch(() => {
    events.push("send");
    return completion('{"level":"high"}');
  });
  const service = createCountedModel({
    endpoint: "http://127.0.0.1:9/api/v1",
    model: "anthropic/claude-haiku-5.5",
    key: () => Promise.resolve("test-model-key"),
    fetch: fake.fetch,
    store: memoryCounter(left, events),
    now: () => new Date("2026-10-12T23:00:00.000Z"),
  });
  return { service, events, sent: fake.sent };
}

const midnight = "2026-10-13T00:00:00.000Z";

describe("a call counted against the account's daily cap", () => {
  it("is counted against the account it is made for, just before it is sent, each time", async () => {
    const { service, events } = counted(5);
    const model = service.forAccount(owner);
    expect(await model.reply(request)).toEqual({ level: "high" });
    await model.reply(request);
    expect(events).toEqual([
      `count ${owner}`,
      "send",
      `count ${owner}`,
      "send",
    ]);
  });

  it("sends nothing over the cap, records when the cap resets, and says so", async () => {
    const { service, events, sent } = counted(0);
    const failure = await service
      .forAccount(owner)
      .reply(request)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CapReached);
    expect(failure).toHaveProperty("resetsAt", new Date(midnight));
    expect(sent).toEqual([]);
    expect(events).toEqual([`count ${owner}`, `record ${owner} ${midnight}`]);
  });

  it("is not a failure of the model, which a sort would try again", async () => {
    const { service } = counted(0);
    const failure = await service
      .forAccount(owner)
      .reply(request)
      .catch((error: unknown) => error);
    expect(failure).not.toBeInstanceOf(ModelFailed);
  });
});

describe("whether the account's daily cap is spent", () => {
  it("is nothing to say while calls are left, and counts nothing", async () => {
    const { service, events } = counted(1);
    expect(await service.spent(owner)).toBeUndefined();
    expect(events).toEqual([]);
  });

  it("gives when the cap resets once it is spent, records it as a refusal does, and counts nothing", async () => {
    const { service, events, sent } = counted(0);
    expect(await service.spent(owner)).toEqual(new Date(midnight));
    expect(events).toEqual([`record ${owner} ${midnight}`]);
    expect(sent).toEqual([]);
  });
});
