// The store against a real DynamoDB, run locally (ADR 9).
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, inject, it } from "vitest";
import { storedItems } from "../test/dynamodb";
import { callerOf, type AccountId } from "./src/identity";
import { pollLimit } from "./src/rate";
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
    const id = await store.postAsk(owner, ask, now);
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
      [1, 2, 3].map(() => store.postAsk(owner, ask, new Date())),
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

describe("the poll's rate counter", () => {
  const minute = new Date("2026-10-11T09:30:10.000Z");

  it("counts each poll in a minute up to the limit, then refuses", async () => {
    const owner = account();
    for (let polls = 0; polls < pollLimit.polls; polls += 1) {
      expect(await store.countPoll(owner, minute)).toEqual({ counted: true });
    }
    expect(await store.countPoll(owner, minute)).toEqual({
      counted: false,
      secondsLeft: 50,
    });
  });

  it("counts afresh in the next minute", async () => {
    const owner = account();
    for (let polls = 0; polls < pollLimit.polls; polls += 1) {
      await store.countPoll(owner, minute);
    }
    const next = new Date("2026-10-11T09:31:00.000Z");
    expect(await store.countPoll(owner, next)).toEqual({ counted: true });
  });

  it("keeps one item a minute, which expires an hour after its minute ends", async () => {
    const owner = account();
    await store.countPoll(owner, minute);
    await store.countPoll(owner, minute);
    await store.countPoll(owner, new Date("2026-10-11T09:31:30.000Z"));
    const items = await storedItems(endpoint, tableName, owner);
    expect(items).toEqual([
      {
        ...keys.pollCount(owner, "2026-10-11T09:30"),
        count: 2,
        expiresAt: Date.parse("2026-10-11T10:31:00.000Z") / 1000,
      },
      {
        ...keys.pollCount(owner, "2026-10-11T09:31"),
        count: 1,
        expiresAt: Date.parse("2026-10-11T10:32:00.000Z") / 1000,
      },
    ]);
  });

  it("leaves the version alone", async () => {
    const owner = account();
    await store.postAsk(owner, ask, new Date());
    await store.countPoll(owner, new Date());
    await store.countPoll(owner, new Date());
    expect((await store.openAsks(owner, new Date())).version).toBe(1);
  });
});

describe("the asks since a version", () => {
  it("says nothing changed when the version is the one given", async () => {
    const owner = account();
    await store.postAsk(owner, ask, new Date());
    expect(await store.asksSince(owner, 1, new Date())).toEqual({
      version: 1,
      unchanged: true,
    });
  });

  it("gives the whole list when the version has moved on", async () => {
    const owner = account();
    const now = new Date("2026-10-11T09:30:00.000Z");
    const id = await store.postAsk(owner, ask, now);
    expect(await store.asksSince(owner, 0, now)).toEqual({
      version: 1,
      everAsked: true,
      asks: [{ id, ...ask, postedAt: now.toISOString() }],
    });
  });

  it("gives the whole list when no version is given", async () => {
    const owner = account();
    expect(await store.asksSince(owner, undefined, new Date())).toEqual({
      version: 0,
      everAsked: false,
      asks: [],
    });
  });
});
