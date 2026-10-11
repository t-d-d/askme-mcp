// Writes that meet another transaction, end to end in process. Every write
// to an account also raises the version on its META item (ADR 13), so two
// writes to one account at the same moment meet there. Real DynamoDB cancels
// one of them with the reason TransactionConflict, and the store tries it
// again. The local DynamoDB runs one transaction at a time and never does
// this, so a recorder in front of it cancels the transactions a test names.
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

// A store that reaches the local DynamoDB directly, for the other writer.
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

// A fresh account for each test, and its id as the token check gives it.
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

// How many transactions the service has sent, cancelled ones included.
const transactions = () =>
  database.calls.filter((call) => call.action === "TransactWriteItems").length;

// The account's version, read straight from its META item.
async function versionOf(owner: AccountId): Promise<number | undefined> {
  const items = await storedItems(endpoint, tableName, owner);
  const meta = items.find((item) => item.sk === keys.meta(owner).sk);
  return z.object({ version: z.number() }).optional().parse(meta)?.version;
}

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
      const items = await storedItems(endpoint, tableName, owner);
      expect(items.map((item) => item.sk)).toEqual([
        keys.meta(owner).sk,
        keys.openAsk(owner, id).sk,
      ]);
      expect(await versionOf(owner)).toBe(1);
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
      const items = await storedItems(endpoint, tableName, owner);
      expect(items.map((item) => item.sk)).toEqual([
        keys.closedAsk(owner, id).sk,
        keys.meta(owner).sk,
      ]);
      expect(await versionOf(owner)).toBe(2);
    } finally {
      await agent.close();
    }
  });

  // Two resolves of one ask at the same moment: the second meets the first,
  // and by its next try the first has closed the ask. Both answer resolved
  // (ADR 2), and the ask closes once.
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
      const result = await agent.callTool({
        name: "resolve",
        arguments: { id },
      });
      // The other resolve closed the ask, so this one found it closed.
      expect(other).toEqual(["resolved"]);
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({ id, status: "resolved" });
      const items = await storedItems(endpoint, tableName, owner);
      expect(items.map((item) => item.sk)).toEqual([
        keys.closedAsk(owner, id).sk,
        keys.meta(owner).sk,
      ]);
      expect(await versionOf(owner)).toBe(2);
    } finally {
      await agent.close();
    }
  });

  // DynamoDB can name a failed condition and a conflict in one answer. The
  // failed condition is the answer the store acts on, so it does not try
  // again.
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

  it("answers service_unavailable when every try is cancelled, and stores nothing", async () => {
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
      expect(await storedItems(endpoint, tableName, owner)).toEqual([]);
    } finally {
      await agent.close();
    }
  });
});
