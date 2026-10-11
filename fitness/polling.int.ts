// The page's poll, end to end in process, on the local DynamoDB. Every call
// the service makes to the database goes through a recorder on loopback, so
// a test can count the reads and writes behind one poll.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { z } from "zod";
import { handler } from "../service/src/handler";
import { callerOf, type AccountId } from "../service/src/identity";
import { pollLimit } from "../service/src/rate";
import { keys } from "../service/src/store/keys";
import { pagePaths } from "../shared/page-api";
import {
  readActions,
  recordDatabase,
  storedItems,
  type DatabaseRecorder,
} from "../test/dynamodb";
import { startFakeIssuer, type FakeIssuer } from "../test/identity";
import { invoke } from "../test/lambda";
import { connect, origin } from "../test/mcp";

let issuer: FakeIssuer;
let recorder: DatabaseRecorder;
beforeAll(async () => {
  issuer = await startFakeIssuer();
  recorder = await recordDatabase(inject("databaseEndpoint"));
  vi.stubEnv("CLERK_ISSUER", issuer.issuer);
  vi.stubEnv("DYNAMODB_ENDPOINT", recorder.endpoint);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await recorder.close();
  await issuer.close();
});

const newAccount = () => `user_${randomUUID().slice(0, 8)}`;

// An account id as the token check gives it, to build the keys a test
// expects with the key module.
const accountId = (sub: string): AccountId =>
  callerOf({
    token: "test",
    clientId: "test",
    scopes: [],
    extra: { accountId: sub, requestId: "r" },
  }).accountId;

const ask = {
  summary: "Approve the plan for the kitchen rewiring",
  area: "Home renovation",
  spoken_detail: "The electrician needs a yes or no before Friday.",
};

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

async function poll(sub: string, since?: number): Promise<Response> {
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

const listSchema = z.strictObject({
  version: z.number(),
  everAsked: z.boolean(),
  asks: z.array(z.looseObject({ id: z.string(), summary: z.string() })),
});

const refusalSchema = z.strictObject({
  code: z.string(),
  class: z.string(),
  message: z.string(),
});

// The calls one poll made to the database.
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

  it("reads the list too when something changed", async () => {
    const sub = newAccount();
    await post(sub);
    const actions = (await callsFor(sub, 0)).map((call) => call.action);
    expect(actions).toEqual(["UpdateItem", "GetItem", "Query"]);
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
  // Ten seconds into a minute, so the window has fifty seconds left. Only
  // the date is faked, and it stands still until a test moves it.
  const start = new Date("2026-10-11T09:30:10.000Z");
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: start });
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  async function pollToTheLimit(sub: string): Promise<void> {
    for (let polls = 0; polls < pollLimit.polls; polls += 1) {
      expect((await poll(sub)).status).toBe(200);
    }
  }

  it("refuses a poll over the limit as rate_limited, saying how long to wait", async () => {
    vi.setSystemTime(start);
    const sub = newAccount();
    await pollToTheLimit(sub);
    const response = await poll(sub);
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const refusal = refusalSchema.parse(await response.json());
    expect(refusal.code).toBe("rate_limited");
    expect(refusal.class).toBe("retry");
    expect(refusal.message).toContain(String(pollLimit.polls));
    expect(refusal.message).toContain("Wait 50 seconds");
  });

  it("stores its count under its own prefix, and nothing else", async () => {
    vi.setSystemTime(start);
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
    vi.setSystemTime(start);
    const sub = newAccount();
    await pollToTheLimit(sub);
    expect((await poll(sub)).status).toBe(429);
    vi.setSystemTime(new Date("2026-10-11T09:31:00.000Z"));
    expect((await poll(sub)).status).toBe(200);
  });

  it("does not limit an agent's asks", async () => {
    vi.setSystemTime(start);
    const sub = newAccount();
    await pollToTheLimit(sub);
    expect((await poll(sub)).status).toBe(429);
    expect((await post(sub)).isError).not.toBe(true);
  });
});
