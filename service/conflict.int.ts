// The local DynamoDB runs one transaction at a time and never cancels one
// for a conflict, so a recorder in front of it cancels the ones a test names.
import { randomUUID } from "node:crypto";
import type { Client } from "@modelcontextprotocol/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  inject,
  it,
  vi,
} from "vitest";
import { z } from "zod";
import {
  recordDatabase,
  storedItems,
  type DatabaseRecorder,
} from "../test/dynamodb";
import { startFakeIssuer, type FakeIssuer } from "../test/identity";
import { connect, refusalOf } from "../test/mcp";
import { handler } from "./src/handler";
import { callerOf, type AccountId } from "./src/identity";
import { keys } from "./src/store/keys";
import { createStore, writeTries, type Resolution } from "./src/store/store";

const endpoint = inject("databaseEndpoint");
const tableName = inject("tableName");

// The other writer, which bypasses the recorder.
const elsewhere = createStore({ tableName, endpoint });

let issuer: FakeIssuer;
let database: DatabaseRecorder;
beforeAll(async () => {
  issuer = await startFakeIssuer();
  database = await recordDatabase(endpoint);
  vi.stubEnv("CLERK_ISSUER", issuer.issuer);
  vi.stubEnv("DYNAMODB_ENDPOINT", database.endpoint);
});
afterEach(() => {
  database.conflict(0);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  elsewhere.close();
  await database.close();
  await issuer.close();
});

function newAccount(): { sub: string; owner: AccountId } {
  const sub = `user_${randomUUID().slice(0, 8)}`;
  const { accountId } = callerOf({
    token: "test",
    clientId: "test",
    scopes: [],
    extra: { accountId: sub, requestId: "r" },
  });
  return { sub, owner: accountId };
}

const agentFor = async (sub: string) =>
  connect(handler, { token: await issuer.token({ claims: { sub } }) });

const ask = {
  summary: "Approve the plan for the kitchen rewiring",
  area: "Home renovation",
  spoken_detail: "The electrician needs a yes or no before Friday.",
};

const post = async (agent: Client) =>
  z
    .object({ id: z.string() })
    .parse(
      (await agent.callTool({ name: "ask", arguments: ask })).structuredContent,
    ).id;

const transactions = () =>
  database.calls.filter((call) => call.action === "TransactWriteItems").length;

async function listed(owner: AccountId) {
  const { version, asks } = await elsewhere.openAsks(owner, new Date());
  return { version, open: asks.map((open) => open.id) };
}

const itemsOf = async (owner: AccountId, id: string) =>
  (await storedItems(endpoint, tableName, owner)).filter(
    (item) => item.id === id,
  );

describe("a write that meets another transaction", () => {
  it("posts the ask once when its first try is cancelled", async () => {
    const { sub, owner } = newAccount();
    const agent = await agentFor(sub);
    try {
      database.conflict(1);
      const before = transactions();
      const result = await agent.callTool({ name: "ask", arguments: ask });
      const { id } = z
        .object({ id: z.string(), status: z.literal("posted") })
        .parse(result.structuredContent);
      expect(transactions() - before).toBe(2);
      expect(await listed(owner)).toEqual({ version: 1, open: [id] });
    } finally {
      await agent.close();
    }
  });

  it("resolves the ask once when its first try is cancelled", async () => {
    const { sub, owner } = newAccount();
    const agent = await agentFor(sub);
    try {
      const id = await post(agent);
      database.conflict(1);
      const before = transactions();
      const result = await agent.callTool({
        name: "resolve",
        arguments: { id },
      });
      expect(result.structuredContent).toEqual({ id, status: "resolved" });
      expect(transactions() - before).toBe(2);
      expect(await listed(owner)).toEqual({ version: 2, open: [] });
      expect(await itemsOf(owner, id)).toEqual([
        expect.objectContaining({
          ...keys.closedAsk(owner, id),
          endedAs: "resolved",
        }),
      ]);
    } finally {
      await agent.close();
    }
  });

  it("answers resolved when another resolve closed the ask while it waited", async () => {
    const { sub, owner } = newAccount();
    const agent = await agentFor(sub);
    try {
      const id = await post(agent);
      const other: Resolution[] = [];
      database.conflict(1, {
        meanwhile: async () => {
          other.push(await elsewhere.resolveAsk(owner, id, new Date()));
        },
      });
      const before = transactions();
      const result = await agent.callTool({
        name: "resolve",
        arguments: { id },
      });
      expect(other).toEqual(["resolved"]);
      expect(transactions() - before).toBe(2);
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({ id, status: "resolved" });
      expect(await listed(owner)).toEqual({ version: 2, open: [] });
      expect(await itemsOf(owner, id)).toEqual([
        expect.objectContaining({
          ...keys.closedAsk(owner, id),
          endedAs: "resolved",
        }),
      ]);
    } finally {
      await agent.close();
    }
  });

  // DynamoDB can name a failed condition and a conflict in one answer.
  it("does not try again when a condition failed as well", async () => {
    const { sub, owner } = newAccount();
    const agent = await agentFor(sub);
    try {
      const id = await post(agent);
      database.conflict(Infinity, {
        meanwhile: () => elsewhere.resolveAsk(owner, id, new Date()),
        conditionFailed: true,
      });
      const before = transactions();
      const result = await agent.callTool({
        name: "resolve",
        arguments: { id },
      });
      expect(result.structuredContent).toEqual({ id, status: "resolved" });
      expect(transactions() - before).toBe(1);
    } finally {
      await agent.close();
    }
  });

  it("answers service_unavailable when every try is cancelled, and posts nothing", async () => {
    const { sub, owner } = newAccount();
    const agent = await agentFor(sub);
    try {
      database.conflict(Infinity);
      const before = transactions();
      const refusal = refusalOf(
        await agent.callTool({ name: "ask", arguments: ask }),
      );
      expect(refusal.code).toBe("service_unavailable");
      expect(refusal.class).toBe("retry");
      expect(transactions() - before).toBe(writeTries);
      expect(await listed(owner)).toEqual({ version: 0, open: [] });
      database.conflict(0);
      const id = await post(agent);
      expect(await listed(owner)).toEqual({ version: 1, open: [id] });
    } finally {
      await agent.close();
    }
  });
});
