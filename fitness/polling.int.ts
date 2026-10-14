import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { z } from "zod";
import { handler } from "../service/src/handler";
import { rateLimits } from "../service/src/rate";
import { keys } from "../service/src/store/keys";
import { pagePaths } from "../shared/page-api";
import { agentAsk } from "../test/asks";
import { accountId, newAccount } from "../test/caller";
import { stopClockAt } from "../test/clock";
import {
  readActions,
  recordDatabase,
  storedItems,
  type DatabaseRecorder,
} from "../test/dynamodb";
import { useFakeIssuer } from "../test/identity";
import { invoke } from "../test/lambda";
import { connect, origin } from "../test/mcp";

const issuer = useFakeIssuer();
let recorder: DatabaseRecorder;
beforeAll(async () => {
  recorder = await recordDatabase(inject("databaseEndpoint"));
  vi.stubEnv("DYNAMODB_ENDPOINT", recorder.endpoint);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await recorder.close();
});

const ask = agentAsk;

async function post(sub: string): Promise<{ isError?: unknown }> {
  const client = await connect(handler, {
    token: await issuer.token({ claims: { sub } }),
  });
  try {
    return await client.callTool({ name: "ask", arguments: ask });
  } finally {
    await client.close();
  }
}

async function poll(sub: string, since?: number | string): Promise<Response> {
  const query = since === undefined ? "" : `?since=${String(since)}`;
  return invoke(
    handler,
    new Request(`${origin}${pagePaths.asks}${query}`, {
      headers: {
        authorization: `Bearer ${await issuer.sessionToken({ claims: { sub } })}`,
      },
    }),
  );
}

const unchangedSchema = z.strictObject({
  version: z.number(),
  unchanged: z.literal(true),
});

const hashtagsSchema = z.array(
  z.object({ name: z.string(), colour: z.number() }),
);

const listSchema = z.strictObject({
  version: z.number(),
  everAsked: z.boolean(),
  hashtags: hashtagsSchema,
  formerHashtags: hashtagsSchema,
  asks: z.array(z.looseObject({ id: z.string(), summary: z.string() })),
});

const refusalSchema = z.strictObject({
  code: z.string(),
  class: z.string(),
  message: z.string(),
});

async function callsFor(sub: string, since: number) {
  recorder.calls.length = 0;
  const response = await poll(sub, since);
  expect(response.status).toBe(200);
  return [...recorder.calls];
}

describe("fitness: an idle poll is cheap (polling.md)", () => {
  it("answers a poll carrying the current version with nothing new", async () => {
    const sub = newAccount();
    await post(sub);
    const response = await poll(sub, 1);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(unchangedSchema.parse(await response.json())).toEqual({
      version: 1,
      unchanged: true,
    });
  });

  it("answers a poll carrying an older version with the whole list", async () => {
    const sub = newAccount();
    await post(sub);
    const answer = listSchema.parse(await (await poll(sub, 0)).json());
    expect(answer.version).toBe(1);
    expect(answer.asks.map((listed) => listed.summary)).toEqual([ask.summary]);
  });

  it("answers a poll carrying no version with the whole list", async () => {
    const sub = newAccount();
    await post(sub);
    const answer = listSchema.parse(await (await poll(sub)).json());
    expect(answer.asks).toHaveLength(1);
  });

  it("makes a single read for a poll with nothing new", async () => {
    const sub = newAccount();
    await post(sub);
    const reads = (await callsFor(sub, 1)).filter((call) =>
      readActions.has(call.action),
    );
    expect(reads).toHaveLength(1);
  });
});

describe("fitness: an idle poll is one read (table-design.md)", () => {
  it("reads META and nothing else, and writes only its counter", async () => {
    const sub = newAccount();
    await post(sub);
    const calls = await callsFor(sub, 1);
    expect(calls).toHaveLength(2);
    const [count, read] = calls;
    expect(count?.action).toBe("UpdateItem");
    expect(count?.sortKeys).toHaveLength(1);
    const counterPrefix = keys.pollCount(accountId(sub), "").sk;
    expect(count?.sortKeys[0]?.startsWith(counterPrefix)).toBe(true);
    expect(read).toEqual({
      action: "GetItem",
      sortKeys: [keys.meta(accountId(sub)).sk],
    });
  });

  it("reads the list, and the rules for their hashtags, when something changed", async () => {
    const sub = newAccount();
    await post(sub);
    const calls = await callsFor(sub, 0);
    expect(calls.map((call) => call.action)).toEqual([
      "UpdateItem",
      "GetItem",
      "Query",
      "GetItem",
    ]);
    expect(calls[3]?.sortKeys).toEqual([keys.rules(accountId(sub)).sk]);
  });
});

describe("fitness: a counter leaves the version alone (table-design.md)", () => {
  it("keeps the version where it was however many times the page polls", async () => {
    const sub = newAccount();
    await post(sub);
    for (let polls = 0; polls < 5; polls += 1) {
      expect(unchangedSchema.parse(await (await poll(sub, 1)).json())).toEqual({
        version: 1,
        unchanged: true,
      });
    }
  });
});

describe("fitness: the poll endpoint has its own rate limit (polling.md)", () => {
  // Ten seconds into a minute, so the window has fifty seconds left.
  const start = new Date("2026-10-11T09:30:10.000Z");
  afterAll(() => {
    vi.useRealTimers();
  });

  async function pollToTheLimit(sub: string): Promise<void> {
    for (let polls = 0; polls < rateLimits.poll.limit; polls += 1) {
      expect((await poll(sub)).status).toBe(200);
    }
  }

  it("refuses a poll over the limit as rate_limited, saying how long to wait", async () => {
    stopClockAt(start);
    const sub = newAccount();
    await pollToTheLimit(sub);
    const response = await poll(sub);
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const refusal = refusalSchema.parse(await response.json());
    expect(refusal.code).toBe("rate_limited");
    expect(refusal.class).toBe("retry");
    expect(refusal.message).toContain(String(rateLimits.poll.limit));
    expect(refusal.message).toContain("Wait 50 seconds");
  });

  it("stores its count under its own prefix, and nothing else", async () => {
    stopClockAt(start);
    const sub = newAccount();
    await poll(sub);
    await poll(sub);
    const items = await storedItems(inject("databaseEndpoint"), "askme", sub);
    expect(items).toEqual([
      expect.objectContaining({
        sk: keys.pollCount(accountId(sub), "2026-10-11T09:30").sk,
        count: 2,
      }),
    ]);
  });

  it("answers again in the next minute", async () => {
    stopClockAt(start);
    const sub = newAccount();
    await pollToTheLimit(sub);
    expect((await poll(sub)).status).toBe(429);
    stopClockAt(new Date("2026-10-11T09:31:00.000Z"));
    expect((await poll(sub)).status).toBe(200);
  });

  it("counts no poll whose version is not a whole number", async () => {
    stopClockAt(start);
    const sub = newAccount();
    expect((await poll(sub, "abc")).status).toBe(400);
    expect(await storedItems(inject("databaseEndpoint"), "askme", sub)).toEqual(
      [],
    );
  });

  it("does not limit an agent's asks", async () => {
    stopClockAt(start);
    const sub = newAccount();
    await pollToTheLimit(sub);
    expect((await poll(sub)).status).toBe(429);
    expect((await post(sub)).isError).not.toBe(true);
  });
});
