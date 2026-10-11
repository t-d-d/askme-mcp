import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { z } from "zod";
import { handler } from "../service/src/handler";
import { callerOf, type AccountId } from "../service/src/identity";
import { askLifetimeDays, createStore } from "../service/src/store/store";
import { pagePaths } from "../shared/page-api";
import { storedItems } from "../test/dynamodb";
import { startFakeIssuer, type FakeIssuer } from "../test/identity";
import { invoke } from "../test/lambda";
import { connect, origin } from "../test/mcp";

const endpoint = inject("databaseEndpoint");
const tableName = inject("tableName");
const store = createStore({ tableName, endpoint });

let issuer: FakeIssuer;
beforeAll(async () => {
  issuer = await startFakeIssuer();
  vi.stubEnv("CLERK_ISSUER", issuer.issuer);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  store.close();
  await issuer.close();
});

const newAccount = () => `user_${randomUUID().slice(0, 8)}`;

// An account id as the token check gives it.
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

async function version(sub: string): Promise<number> {
  const response = await invoke(
    handler,
    new Request(`${origin}${pagePaths.asks}`, {
      headers: {
        authorization: `Bearer ${await issuer.sessionToken({ claims: { sub } })}`,
      },
    }),
  );
  return z.object({ version: z.number() }).parse(await response.json()).version;
}

describe("fitness: every change raises the version (table-design.md)", () => {
  it("raises it on posting", async () => {
    const sub = newAccount();
    const client = await connect(handler, {
      token: await issuer.token({ claims: { sub } }),
    });
    try {
      expect(await version(sub)).toBe(0);
      await client.callTool({ name: "ask", arguments: ask });
      expect(await version(sub)).toBe(1);
      await client.callTool({ name: "ask", arguments: ask });
      expect(await version(sub)).toBe(2);
    } finally {
      await client.close();
    }
  });

  it("leaves it alone when an ask is refused", async () => {
    const sub = newAccount();
    const client = await connect(handler, {
      token: await issuer.token({ claims: { sub } }),
    });
    try {
      await client.callTool({
        name: "ask",
        arguments: { ...ask, summary: "" },
      });
      expect(await version(sub)).toBe(0);
    } finally {
      await client.close();
    }
  });
});

describe("fitness: expiry on read (table-design.md)", () => {
  it("treats an ask past its expiry, but still stored, as absent", async () => {
    const owner = accountId(newAccount());
    const posted = new Date(Date.now() - (askLifetimeDays + 1) * 86_400_000);
    await store.postAsk(
      owner,
      { summary: "Old", area: "Old", spokenDetail: "Old" },
      posted,
    );
    const stored = await storedItems(endpoint, tableName, owner);
    expect(stored.filter((item) => item.id !== undefined)).toHaveLength(1);
    expect((await store.openAsks(owner, new Date())).asks).toEqual([]);
  });
});
