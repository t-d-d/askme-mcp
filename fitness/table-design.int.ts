import { randomUUID } from "node:crypto";
import type { Client } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { z } from "zod";
import { handler } from "../service/src/handler";
import { callerOf, type AccountId } from "../service/src/identity";
import { keys } from "../service/src/store/keys";
import { askLifetimeDays, createStore } from "../service/src/store/store";
import { askChangePaths, pagePaths } from "../shared/page-api";
import { handler as sorter } from "../service/src/sorter";
import { storedItems } from "../test/dynamodb";
import { fakes } from "../test/fakes";
import { startFakeIssuer, type FakeIssuer } from "../test/identity";
import { invoke } from "../test/lambda";
import { connect, origin, refusalOf } from "../test/mcp";

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

async function postWith(
  client: Client,
  args: Record<string, string>,
): Promise<string> {
  const result = await client.callTool({ name: "ask", arguments: args });
  return z.object({ id: z.string() }).parse(result.structuredContent).id;
}

// The version the page reads, and the ids of the open asks.
async function listed(sub: string) {
  const response = await invoke(
    handler,
    new Request(`${origin}${pagePaths.asks}`, {
      headers: {
        authorization: `Bearer ${await issuer.sessionToken({ claims: { sub } })}`,
      },
    }),
  );
  return z
    .object({
      version: z.number(),
      asks: z.array(z.object({ id: z.string() })),
    })
    .parse(await response.json());
}

const version = async (sub: string) => (await listed(sub)).version;

const putRules = async (sub: string, text: string) =>
  invoke(
    handler,
    new Request(`${origin}${pagePaths.rules}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${await issuer.sessionToken({ claims: { sub } })}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text }),
    }),
  );

// Saves the rules, with the model reading the hashtags given.
async function saveRules(sub: string, text: string, hashtags: string[]) {
  fakes.model.reply({ json: { hashtags, hours: [] } });
  const response = await putRules(sub, text);
  expect(response.status).toBe(200);
}

// A change from the page to one ask, as the signed-in person.
const changeAsk = async (sub: string, path: string, id: string) =>
  invoke(
    handler,
    new Request(`${origin}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await issuer.sessionToken({ claims: { sub } })}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ id }),
    }),
  );

// Runs the sorts handed on so far, as Lambda would.
const runSorts = () =>
  fakes.lambda.drain((payload) => sorter(payload, { awsRequestId: "sort-1" }));

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
      await client.callTool({
        name: "ask",
        arguments: { ...ask, summary: "Another" },
      });
      expect(await version(sub)).toBe(2);
    } finally {
      await client.close();
    }
  });

  it("leaves it alone when a repeated ask stores nothing", async () => {
    const sub = newAccount();
    const client = await connect(handler, {
      token: await issuer.token({ claims: { sub } }),
    });
    try {
      await client.callTool({ name: "ask", arguments: ask });
      await client.callTool({ name: "ask", arguments: ask });
      expect(await version(sub)).toBe(1);
    } finally {
      await client.close();
    }
  });

  it("raises it on closing, and leaves it alone when the ask was already closed", async () => {
    const sub = newAccount();
    const client = await connect(handler, {
      token: await issuer.token({ claims: { sub } }),
    });
    try {
      const id = await postWith(client, ask);
      expect(await version(sub)).toBe(1);
      await client.callTool({ name: "resolve", arguments: { id } });
      expect(await version(sub)).toBe(2);
      await client.callTool({ name: "resolve", arguments: { id } });
      expect(await version(sub)).toBe(2);
    } finally {
      await client.close();
    }
  });

  it("raises it once on replacing, which closes one ask and posts another", async () => {
    const sub = newAccount();
    const client = await connect(handler, {
      token: await issuer.token({ claims: { sub } }),
    });
    try {
      const old = await postWith(client, ask);
      expect(await version(sub)).toBe(1);
      const id = await postWith(client, {
        ...ask,
        summary: "Revised",
        replaces: old,
      });
      expect(await listed(sub)).toEqual({ version: 2, asks: [{ id }] });
    } finally {
      await client.close();
    }
  });

  it("raises it on opening, and leaves it alone when the ask was already opened", async () => {
    const sub = newAccount();
    const client = await connect(handler, {
      token: await issuer.token({ claims: { sub } }),
    });
    try {
      const id = await postWith(client, ask);
      expect(await version(sub)).toBe(1);
      expect((await changeAsk(sub, askChangePaths.opened, id)).status).toBe(
        204,
      );
      expect(await version(sub)).toBe(2);
      await changeAsk(sub, askChangePaths.opened, id);
      expect(await version(sub)).toBe(2);
    } finally {
      await client.close();
    }
  });

  it("raises it on dismissing, and leaves it alone when the ask was already closed", async () => {
    const sub = newAccount();
    const client = await connect(handler, {
      token: await issuer.token({ claims: { sub } }),
    });
    try {
      const id = await postWith(client, ask);
      expect(await version(sub)).toBe(1);
      expect((await changeAsk(sub, askChangePaths.dismissed, id)).status).toBe(
        204,
      );
      expect(await listed(sub)).toEqual({ version: 2, asks: [] });
      await changeAsk(sub, askChangePaths.dismissed, id);
      await changeAsk(sub, askChangePaths.opened, id);
      expect(await version(sub)).toBe(2);
    } finally {
      await client.close();
    }
  });

  it("leaves it alone when the page names an ask the account does not have", async () => {
    const sub = newAccount();
    const client = await connect(handler, {
      token: await issuer.token({ claims: { sub } }),
    });
    try {
      await postWith(client, ask);
      for (const path of Object.values(askChangePaths)) {
        await changeAsk(sub, path, "AAAAAAAAAAAAAAAAAAAAAAAA");
      }
      expect(await version(sub)).toBe(1);
    } finally {
      await client.close();
    }
  });

  it("raises it when a sort result arrives, and leaves it alone when the ask closed first", async () => {
    const sub = newAccount();
    const client = await connect(handler, {
      token: await issuer.token({ claims: { sub } }),
    });
    try {
      await saveRules(sub, "#home is the house.", ["home"]);
      const id = await postWith(client, ask);
      expect(await version(sub)).toBe(2);
      fakes.model.reply({
        json: { hashtags: ["home"], level: "high", reason: "Friday." },
      });
      await runSorts();
      expect(await version(sub)).toBe(3);

      const closed = await postWith(client, { ...ask, summary: "Closed" });
      await client.callTool({ name: "resolve", arguments: { id: closed } });
      expect(await version(sub)).toBe(5);
      // The closed ask's sort finds it gone, and asks no model.
      const calls = fakes.model.calls.length;
      await runSorts();
      expect(fakes.model.calls).toHaveLength(calls);
      expect(await version(sub)).toBe(5);
      expect(id).not.toBe(closed);
    } finally {
      await client.close();
    }
  });

  it("raises it on saving the rules, whether or not the model could read them", async () => {
    const sub = newAccount();
    await saveRules(sub, "#home is the house.", ["home"]);
    expect(await version(sub)).toBe(1);
    fakes.model.reply({ status: 502 });
    const response = await putRules(sub, "#home and #garden.");
    expect(
      z.object({ readFailed: z.boolean() }).parse(await response.json()),
    ).toEqual({ readFailed: true });
    expect(await version(sub)).toBe(2);
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

describe("fitness: posting is atomic (table-design.md)", () => {
  it("leaves one open ask, one count and one id when twenty identical asks arrive at once", async () => {
    const sub = newAccount();
    const owner = accountId(sub);
    const client = await connect(handler, {
      token: await issuer.token({ claims: { sub } }),
    });
    let ids: string[];
    try {
      ids = await Promise.all(
        Array.from({ length: 20 }, () => postWith(client, ask)),
      );
    } finally {
      await client.close();
    }
    expect(new Set(ids).size).toBe(1);

    const items = await storedItems(endpoint, tableName, sub);
    const asks = items.filter((item) => typeof item.summary === "string");
    expect(asks).toEqual([
      expect.objectContaining({ ...keys.openAsk(owner, ids[0] ?? "") }),
    ]);
    // The day's count, raised once, under the key for the day the ask was
    // posted. The rate counter counts every call, the repeats included.
    const at = new Date(z.string().parse(asks[0]?.postedAt));
    const daily = items.filter((item) => item.sk === keys.usage(owner, at).sk);
    expect(daily).toEqual([expect.objectContaining({ count: 1 })]);
    const calls = items
      .filter((item) => String(item.sk).startsWith(keys.askCount(owner, "").sk))
      .map((item) => z.number().parse(item.count));
    expect(calls.reduce((sum, count) => sum + count, 0)).toBe(20);
    expect(await version(sub)).toBe(1);
  });
});

describe("fitness: accounts are apart (table-design.md)", () => {
  it("answers not_found to a resolve of another account's ask, and changes nothing", async () => {
    const [owner, other] = [newAccount(), newAccount()];
    const ownerAgent = await connect(handler, {
      token: await issuer.token({ claims: { sub: owner } }),
    });
    const id = await postWith(ownerAgent, ask);
    await ownerAgent.close();
    const ownerItems = await storedItems(endpoint, tableName, owner);

    const otherAgent = await connect(handler, {
      token: await issuer.token({ claims: { sub: other } }),
    });
    const refusal = refusalOf(
      await otherAgent.callTool({ name: "resolve", arguments: { id } }),
    );
    await otherAgent.close();

    expect(refusal.code).toBe("not_found");
    expect(await storedItems(endpoint, tableName, owner)).toEqual(ownerItems);
    expect(await storedItems(endpoint, tableName, other)).toEqual([]);
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
