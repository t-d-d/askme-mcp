import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createModel, ModelFailed, type ModelRequest } from "./model";

interface Sent {
  url: string;
  headers: Headers;
  body: unknown;
}

// A fetch that answers from memory and keeps what it was sent.
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

// OpenRouter's answer, as a chat completion with the reply as its content.
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
  // No temperature: with require_parameters, OpenRouter refuses the call when
  // no endpoint takes it, and none for anthropic/claude-haiku-5.5 does.
  it("sends one chat completion with the schema, no tools, no temperature, and providers that keep no prompts", async () => {
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
      max_tokens: 200,
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
  // A key that takes this long to read, as from a slow Parameter Store.
  const keyAfter = (ms: number) => () =>
    new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve("k");
      }, ms);
    });

  // A model that answers after this long, unless the call is cut short.
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
