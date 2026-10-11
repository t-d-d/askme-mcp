// The store against a real DynamoDB, run locally (ADR 9).
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, inject, it } from "vitest";
import { storedItems } from "../test/dynamodb";
import { callerOf, type AccountId } from "./src/identity";
import { keys } from "./src/store/keys";
import { askLifetimeDays, createStore, type NewAsk } from "./src/store/store";

const endpoint = inject("databaseEndpoint");
const tableName = inject("tableName");
const store = createStore({ tableName, endpoint });
afterAll(() => {
  store.close();
});

// A fresh account for each test, as only a verified token gives one.
const account = (): AccountId =>
  callerOf({
    token: "test",
    clientId: "test",
    scopes: [],
    extra: { accountId: `user_${randomUUID().slice(0, 8)}`, requestId: "r" },
  }).accountId;

const ask: NewAsk = {
  summary: "Approve the plan for the kitchen rewiring",
  area: "Home renovation",
  spokenDetail: "The electrician needs a yes or no before Friday.",
  actionLink: "https://github.com/t-d-d/askme-mcp/pull/1",
};

const day = 86_400_000;

describe("the store", () => {
  it("has nothing for an account that never posted", async () => {
    expect(await store.openAsks(account(), new Date())).toEqual({
      version: 0,
      everAsked: false,
      asks: [],
    });
  });

  it("lists a posted ask as open, under the id it gave", async () => {
    const owner = account();
    const now = new Date("2026-10-11T09:30:00.000Z");
    const { id } = await store.postAsk(owner, ask, now);
    expect(await store.openAsks(owner, now)).toEqual({
      version: 1,
      everAsked: true,
      asks: [{ id, ...ask, postedAt: "2026-10-11T09:30:00.000Z" }],
    });
  });

  it("keeps the optional fields an agent left out out of the item", async () => {
    const owner = account();
    const bare = {
      summary: ask.summary,
      area: ask.area,
      spokenDetail: ask.spokenDetail,
    };
    await store.postAsk(owner, bare, new Date());
    const [stored] = (await store.openAsks(owner, new Date())).asks;
    expect(stored).not.toHaveProperty("actionLink");
    expect(stored).not.toHaveProperty("sessionLink");
    expect(stored).not.toHaveProperty("replaces");
  });

  it("gives each ask a long random id", async () => {
    const owner = account();
    const ids = await Promise.all(
      [1, 2, 3].map(
        async () => (await store.postAsk(owner, ask, new Date())).id,
      ),
    );
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{24}$/u);
    expect(new Set(ids).size).toBe(3);
  });

  it("keeps each account's asks apart", async () => {
    const [first, second] = [account(), account()];
    await store.postAsk(first, ask, new Date());
    expect((await store.openAsks(second, new Date())).asks).toEqual([]);
    expect((await store.openAsks(first, new Date())).asks).toHaveLength(1);
  });

  it("stores an ask to expire a month after it was posted", async () => {
    const owner = account();
    const now = new Date("2026-10-11T09:30:00.000Z");
    await store.postAsk(owner, ask, now);
    const items = await storedItems(endpoint, tableName, owner);
    const expiries = items.map((item) => item.expiresAt).filter(Boolean);
    expect(expiries).toEqual([(now.getTime() + askLifetimeDays * day) / 1000]);
  });

  it("lists an ask until the moment it expires, and not after", async () => {
    const owner = account();
    const posted = new Date("2026-10-11T09:30:00.000Z");
    await store.postAsk(owner, ask, posted);
    const expires = posted.getTime() + askLifetimeDays * day;
    const at = async (time: number) =>
      (await store.openAsks(owner, new Date(time))).asks.length;
    expect(await at(expires - 1000)).toBe(1);
    expect(await at(expires)).toBe(0);
  });
});

// What is stored for one ask, open or closed, read straight from the table.
const itemsOf = async (owner: AccountId, id: string) =>
  (await storedItems(endpoint, tableName, owner)).filter(
    (item) => item.id === id,
  );

const versionOf = async (owner: AccountId) =>
  (await store.openAsks(owner, new Date())).version;

describe("resolving an ask", () => {
  it("closes an open ask as resolved, and the list no longer holds it", async () => {
    const owner = account();
    const posted = new Date("2026-10-11T09:30:00.000Z");
    const closed = new Date("2026-10-11T10:00:00.000Z");
    const { id } = await store.postAsk(owner, ask, posted);
    expect(await store.resolveAsk(owner, id, closed)).toBe("resolved");
    expect(await store.openAsks(owner, closed)).toEqual({
      version: 2,
      everAsked: true,
      asks: [],
    });
    expect(await itemsOf(owner, id)).toEqual([
      {
        ...keys.closedAsk(owner, id),
        id,
        ...ask,
        postedAt: posted.toISOString(),
        expiresAt: (posted.getTime() + askLifetimeDays * day) / 1000,
        endedAs: "resolved",
        closedAt: closed.toISOString(),
      },
    ]);
  });

  it("answers already-closed for an ask it closed before, and changes nothing", async () => {
    const owner = account();
    const { id } = await store.postAsk(owner, ask, new Date());
    await store.resolveAsk(owner, id, new Date());
    const before = await itemsOf(owner, id);
    expect(await store.resolveAsk(owner, id, new Date())).toBe(
      "already-closed",
    );
    expect(await itemsOf(owner, id)).toEqual(before);
    expect(await versionOf(owner)).toBe(2);
  });

  it("answers not-found for an id the account has no ask for, and changes nothing", async () => {
    const owner = account();
    await store.postAsk(owner, ask, new Date());
    expect(
      await store.resolveAsk(owner, "AAAAAAAAAAAAAAAAAAAAAAAA", new Date()),
    ).toBe("not-found");
    expect(await versionOf(owner)).toBe(1);
    expect((await store.openAsks(owner, new Date())).asks).toHaveLength(1);
  });

  it("answers not-found for an ask past its expiry, and leaves it as it is", async () => {
    const owner = account();
    const posted = new Date(Date.now() - (askLifetimeDays + 1) * day);
    const { id } = await store.postAsk(owner, ask, posted);
    const before = await itemsOf(owner, id);
    expect(await store.resolveAsk(owner, id, new Date())).toBe("not-found");
    expect(await itemsOf(owner, id)).toEqual(before);
  });

  it("closes an ask once when several resolves arrive together", async () => {
    const owner = account();
    const { id } = await store.postAsk(owner, ask, new Date());
    const answers = await Promise.all(
      [1, 2, 3, 4, 5].map(() => store.resolveAsk(owner, id, new Date())),
    );
    expect(answers.filter((answer) => answer === "resolved")).toHaveLength(1);
    expect(
      answers.filter((answer) => answer === "already-closed"),
    ).toHaveLength(4);
    expect(await itemsOf(owner, id)).toHaveLength(1);
    expect(await versionOf(owner)).toBe(2);
  });
});

describe("replacing an ask", () => {
  const newer: NewAsk = {
    summary: "Approve the revised plan for the kitchen rewiring",
    area: "Home renovation",
    spokenDetail: "The electrician changed the plan. It needs a yes or no.",
  };

  it("closes the old ask as replaced, and lists the new one in its place, waiting since the old one", async () => {
    const owner = account();
    const first = new Date("2026-10-11T09:30:00.000Z");
    const second = new Date("2026-10-11T11:00:00.000Z");
    const old = await store.postAsk(owner, ask, first);
    const posted = await store.postAsk(
      owner,
      { ...newer, replaces: old.id },
      second,
    );
    expect(posted.replaced).toBe(true);
    expect(await store.openAsks(owner, second)).toEqual({
      version: 2,
      everAsked: true,
      asks: [
        {
          id: posted.id,
          ...newer,
          replaces: old.id,
          postedAt: first.toISOString(),
        },
      ],
    });
    const expiresAt = (first.getTime() + askLifetimeDays * day) / 1000;
    expect(await itemsOf(owner, old.id)).toEqual([
      {
        ...keys.closedAsk(owner, old.id),
        id: old.id,
        ...ask,
        postedAt: first.toISOString(),
        expiresAt,
        endedAs: "replaced",
        closedAt: second.toISOString(),
      },
    ]);
    expect(await itemsOf(owner, posted.id)).toEqual([
      expect.objectContaining({ ...keys.openAsk(owner, posted.id), expiresAt }),
    ]);
  });

  it("posts the ask as new when replaces names no ask of this account", async () => {
    const owner = account();
    const now = new Date("2026-10-11T11:00:00.000Z");
    const posted = await store.postAsk(
      owner,
      { ...newer, replaces: "AAAAAAAAAAAAAAAAAAAAAAAA" },
      now,
    );
    expect(posted.replaced).toBe(false);
    expect(await store.openAsks(owner, now)).toEqual({
      version: 1,
      everAsked: true,
      asks: [
        {
          id: posted.id,
          ...newer,
          replaces: "AAAAAAAAAAAAAAAAAAAAAAAA",
          postedAt: now.toISOString(),
        },
      ],
    });
  });

  // Which call wins is up to the database, so five races run at once, and
  // both outcomes are checked whichever happens.
  it("posts the new ask either way when a resolve closes the old one at the same moment", async () => {
    const owner = account();
    const race = async () => {
      const old = await store.postAsk(owner, ask, new Date());
      const [resolved, posted] = await Promise.all([
        store.resolveAsk(owner, old.id, new Date()),
        store.postAsk(owner, { ...newer, replaces: old.id }, new Date()),
      ]);
      expect(resolved).toBe(posted.replaced ? "already-closed" : "resolved");
      expect(await itemsOf(owner, old.id)).toEqual([
        expect.objectContaining({
          endedAs: posted.replaced ? "replaced" : "resolved",
        }),
      ]);
      return posted;
    };
    const posts = await Promise.all([1, 2, 3, 4, 5].map(race));
    const { asks, version } = await store.openAsks(owner, new Date());
    expect(asks.map(({ id }) => id).sort()).toEqual(
      posts.map(({ id }) => id).sort(),
    );
    // Each race posts once and closes once: one write when the replace wins,
    // and two when the resolve does.
    const writes = posts.map(({ replaced }) => (replaced ? 2 : 3));
    expect(version).toBe(writes.reduce((sum, count) => sum + count, 0));
  });

  it("posts the ask as new when replaces names an ask already closed", async () => {
    const owner = account();
    const old = await store.postAsk(owner, ask, new Date());
    await store.resolveAsk(owner, old.id, new Date());
    const now = new Date();
    const posted = await store.postAsk(
      owner,
      { ...newer, replaces: old.id },
      now,
    );
    expect(posted.replaced).toBe(false);
    const [listed] = (await store.openAsks(owner, now)).asks;
    expect(listed?.postedAt).toBe(now.toISOString());
    expect(await itemsOf(owner, old.id)).toEqual([
      expect.objectContaining({ endedAs: "resolved" }),
    ]);
  });
});
