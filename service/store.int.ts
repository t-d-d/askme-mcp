// The store against a real DynamoDB, run locally (ADR 9).
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, inject, it } from "vitest";
import { z } from "zod";
import { storedItems } from "../test/dynamodb";
import { callerOf, type AccountId } from "./src/identity";
import {
  askLimit,
  pollLimit,
  rulesSaveLimit,
  sortRetryLimit,
} from "./src/rate";
import { exampleRules, type HashtagWindow } from "./src/rules";
import { keys } from "./src/store/keys";
import {
  askLifetimeDays,
  createStore,
  dailyAskCap,
  dedupeWindowMinutes,
  type NewAsk,
} from "./src/store/store";

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
const minute = 60_000;

// Posts an ask the store must take as new, and gives its id and whether it
// replaced one.
async function postNew(owner: AccountId, newAsk: NewAsk, now: Date) {
  const posting = await store.postAsk(owner, newAsk, now);
  if (posting.kind !== "posted") {
    throw new Error(`The store did not post the ask: ${posting.kind}`);
  }
  return posting;
}

// An ask of its own for each number.
const numbered = (n: number): NewAsk => ({
  ...ask,
  summary: `${ask.summary} ${String(n)}`,
});

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
    const { id } = await postNew(owner, ask, now);
    expect(await store.openAsks(owner, now)).toEqual({
      version: 1,
      everAsked: true,
      asks: [
        {
          id,
          ...ask,
          postedAt: "2026-10-11T09:30:00.000Z",
          storedAt: "2026-10-11T09:30:00.000Z",
        },
      ],
    });
  });

  it("keeps the optional fields an agent left out out of the item", async () => {
    const owner = account();
    const bare = {
      summary: ask.summary,
      area: ask.area,
      spokenDetail: ask.spokenDetail,
    };
    await postNew(owner, bare, new Date());
    const [stored] = (await store.openAsks(owner, new Date())).asks;
    expect(stored).not.toHaveProperty("actionLink");
    expect(stored).not.toHaveProperty("sessionLink");
    expect(stored).not.toHaveProperty("replaces");
  });

  it("gives each ask a long random id", async () => {
    const owner = account();
    const ids = await Promise.all(
      [1, 2, 3].map(
        async (n) => (await postNew(owner, numbered(n), new Date())).id,
      ),
    );
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{24}$/u);
    expect(new Set(ids).size).toBe(3);
  });

  it("keeps each account's asks apart", async () => {
    const [first, second] = [account(), account()];
    await postNew(first, ask, new Date());
    expect((await store.openAsks(second, new Date())).asks).toEqual([]);
    expect((await store.openAsks(first, new Date())).asks).toHaveLength(1);
  });

  it("stores an ask to expire a month after it was posted", async () => {
    const owner = account();
    const now = new Date("2026-10-11T09:30:00.000Z");
    await postNew(owner, ask, now);
    const items = await storedItems(endpoint, tableName, owner);
    const expiries = items
      .filter((item) => typeof item.summary === "string")
      .map((item) => item.expiresAt);
    expect(expiries).toEqual([(now.getTime() + askLifetimeDays * day) / 1000]);
  });

  it("lists an ask until the moment it expires, and not after", async () => {
    const owner = account();
    const posted = new Date("2026-10-11T09:30:00.000Z");
    await postNew(owner, ask, posted);
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
    const { id } = await postNew(owner, ask, posted);
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
        storedAt: posted.toISOString(),
        expiresAt: (posted.getTime() + askLifetimeDays * day) / 1000,
        endedAs: "resolved",
        closedAt: closed.toISOString(),
      },
    ]);
  });

  it("answers already-closed for an ask it closed before, and changes nothing", async () => {
    const owner = account();
    const { id } = await postNew(owner, ask, new Date());
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
    await postNew(owner, ask, new Date());
    expect(
      await store.resolveAsk(owner, "AAAAAAAAAAAAAAAAAAAAAAAA", new Date()),
    ).toBe("not-found");
    expect(await versionOf(owner)).toBe(1);
    expect((await store.openAsks(owner, new Date())).asks).toHaveLength(1);
  });

  it("answers not-found for an ask past its expiry, and leaves it as it is", async () => {
    const owner = account();
    const posted = new Date(Date.now() - (askLifetimeDays + 1) * day);
    const { id } = await postNew(owner, ask, posted);
    const before = await itemsOf(owner, id);
    expect(await store.resolveAsk(owner, id, new Date())).toBe("not-found");
    expect(await itemsOf(owner, id)).toEqual(before);
  });

  it("closes an ask once when several resolves arrive together", async () => {
    const owner = account();
    const { id } = await postNew(owner, ask, new Date());
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

describe("opening an ask", () => {
  it("marks an open ask as opened, and keeps it open", async () => {
    const owner = account();
    const posted = new Date("2026-10-11T09:30:00.000Z");
    const opened = new Date("2026-10-11T09:40:00.000Z");
    const { id } = await postNew(owner, ask, posted);
    expect(await store.markOpened(owner, id, opened)).toBe("opened");
    expect(await store.openAsks(owner, opened)).toEqual({
      version: 2,
      everAsked: true,
      asks: [
        {
          id,
          ...ask,
          postedAt: posted.toISOString(),
          storedAt: posted.toISOString(),
          openedAt: opened.toISOString(),
        },
      ],
    });
    expect(await itemsOf(owner, id)).toEqual([
      expect.objectContaining({ ...keys.openAsk(owner, id) }),
    ]);
  });

  it("answers unchanged for an ask already opened, and keeps when it was first opened", async () => {
    const owner = account();
    const first = new Date("2026-10-11T09:40:00.000Z");
    const { id } = await postNew(owner, ask, new Date("2026-10-11T09:30Z"));
    await store.markOpened(owner, id, first);
    const before = await itemsOf(owner, id);
    expect(
      await store.markOpened(owner, id, new Date("2026-10-11T09:50Z")),
    ).toBe("unchanged");
    expect(await itemsOf(owner, id)).toEqual(before);
    expect(await versionOf(owner)).toBe(2);
  });

  it("answers unchanged for an ask that has closed, and leaves it closed", async () => {
    const owner = account();
    const { id } = await postNew(owner, ask, new Date());
    await store.resolveAsk(owner, id, new Date());
    const before = await itemsOf(owner, id);
    expect(await store.markOpened(owner, id, new Date())).toBe("unchanged");
    expect(await itemsOf(owner, id)).toEqual(before);
    expect(await versionOf(owner)).toBe(2);
  });

  it("answers not-found for an id the account has no ask for, and changes nothing", async () => {
    const owner = account();
    await postNew(owner, ask, new Date());
    expect(
      await store.markOpened(owner, "AAAAAAAAAAAAAAAAAAAAAAAA", new Date()),
    ).toBe("not-found");
    expect(await versionOf(owner)).toBe(1);
  });

  it("answers not-found for another account's ask, and leaves it unopened", async () => {
    const [owner, other] = [account(), account()];
    const { id } = await postNew(owner, ask, new Date());
    expect(await store.markOpened(other, id, new Date())).toBe("not-found");
    const [listed] = (await store.openAsks(owner, new Date())).asks;
    expect(listed).not.toHaveProperty("openedAt");
  });

  it("marks an ask opened once when several arrive together", async () => {
    const owner = account();
    const { id } = await postNew(owner, ask, new Date());
    const answers = await Promise.all(
      [1, 2, 3, 4, 5].map(() => store.markOpened(owner, id, new Date())),
    );
    expect(answers.filter((answer) => answer === "opened")).toHaveLength(1);
    expect(answers.filter((answer) => answer === "unchanged")).toHaveLength(4);
    expect(await versionOf(owner)).toBe(2);
  });

  it("starts the ask that replaces an opened one unopened", async () => {
    const owner = account();
    const { id: old } = await postNew(owner, ask, new Date());
    await store.markOpened(owner, old, new Date());
    const { id } = await postNew(
      owner,
      { ...ask, summary: "Revised", replaces: old },
      new Date(),
    );
    const { asks } = await store.openAsks(owner, new Date());
    expect(asks.map((listed) => listed.id)).toEqual([id]);
    expect(asks[0]).not.toHaveProperty("openedAt");
  });
});

describe("dismissing an ask", () => {
  it("closes an open ask as dismissed, and the list no longer holds it", async () => {
    const owner = account();
    const posted = new Date("2026-10-11T09:30:00.000Z");
    const closed = new Date("2026-10-11T10:00:00.000Z");
    const { id } = await postNew(owner, ask, posted);
    expect(await store.dismissAsk(owner, id, closed)).toBe("dismissed");
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
        storedAt: posted.toISOString(),
        expiresAt: (posted.getTime() + askLifetimeDays * day) / 1000,
        endedAs: "dismissed",
        closedAt: closed.toISOString(),
      },
    ]);
  });

  it("keeps when an opened ask was opened once it is dismissed", async () => {
    const owner = account();
    const opened = new Date("2026-10-11T09:40:00.000Z");
    const { id } = await postNew(owner, ask, new Date("2026-10-11T09:30Z"));
    await store.markOpened(owner, id, opened);
    await store.dismissAsk(owner, id, new Date("2026-10-11T10:00Z"));
    expect(await itemsOf(owner, id)).toEqual([
      expect.objectContaining({
        ...keys.closedAsk(owner, id),
        openedAt: opened.toISOString(),
        endedAs: "dismissed",
      }),
    ]);
  });

  it("answers unchanged for an ask its agent resolved first, and leaves it resolved", async () => {
    const owner = account();
    const { id } = await postNew(owner, ask, new Date());
    await store.resolveAsk(owner, id, new Date());
    const before = await itemsOf(owner, id);
    expect(await store.dismissAsk(owner, id, new Date())).toBe("unchanged");
    expect(await itemsOf(owner, id)).toEqual(before);
    expect(await versionOf(owner)).toBe(2);
  });

  it("answers not-found for an id the account has no ask for, and changes nothing", async () => {
    const owner = account();
    await postNew(owner, ask, new Date());
    expect(
      await store.dismissAsk(owner, "AAAAAAAAAAAAAAAAAAAAAAAA", new Date()),
    ).toBe("not-found");
    expect(await versionOf(owner)).toBe(1);
  });

  it("lets the agent resolve a dismissed ask, which succeeds as already closed", async () => {
    const owner = account();
    const { id } = await postNew(owner, ask, new Date());
    await store.dismissAsk(owner, id, new Date());
    expect(await store.resolveAsk(owner, id, new Date())).toBe(
      "already-closed",
    );
  });
});

describe("replacing an ask", () => {
  const newer: NewAsk = {
    summary: "Approve the revised plan for the kitchen rewiring",
    area: "Home renovation",
    spokenDetail: "The electrician changed the plan. It needs a yes or no.",
  };

  it("closes the old ask as replaced, and lists the new one in its place, waiting since the old one but stored now", async () => {
    const owner = account();
    const first = new Date("2026-10-11T09:30:00.000Z");
    const second = new Date("2026-10-11T11:00:00.000Z");
    const old = await postNew(owner, ask, first);
    const posted = await postNew(owner, { ...newer, replaces: old.id }, second);
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
          storedAt: second.toISOString(),
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
        storedAt: first.toISOString(),
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
    const posted = await postNew(
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
          storedAt: now.toISOString(),
        },
      ],
    });
  });

  // Which call wins is up to the database, so five races run at once, and
  // both outcomes are checked whichever happens.
  it("posts the new ask either way when a resolve closes the old one at the same moment", async () => {
    const owner = account();
    const race = async (n: number) => {
      const old = await postNew(owner, numbered(n), new Date());
      const [resolved, posted] = await Promise.all([
        store.resolveAsk(owner, old.id, new Date()),
        postNew(owner, { ...newer, replaces: old.id }, new Date()),
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
    const old = await postNew(owner, ask, new Date());
    await store.resolveAsk(owner, old.id, new Date());
    const now = new Date();
    const posted = await postNew(owner, { ...newer, replaces: old.id }, now);
    expect(posted.replaced).toBe(false);
    const [listed] = (await store.openAsks(owner, now)).asks;
    expect(listed?.postedAt).toBe(now.toISOString());
    expect(await itemsOf(owner, old.id)).toEqual([
      expect.objectContaining({ endedAs: "resolved" }),
    ]);
  });
});

describe("matching a repeated ask", () => {
  it("answers with the first id, and stores nothing new", async () => {
    const owner = account();
    const now = new Date("2026-10-11T09:30:00.000Z");
    const { id } = await postNew(owner, ask, now);
    const before = await storedItems(endpoint, tableName, owner);
    expect(await store.postAsk(owner, ask, now)).toEqual({
      kind: "matched",
      id,
    });
    expect(await storedItems(endpoint, tableName, owner)).toEqual(before);
  });

  it("answers a repeat of an ask that replaced another with the new id, and closes nothing more", async () => {
    const owner = account();
    const now = new Date("2026-10-11T09:30:00.000Z");
    const old = await postNew(owner, ask, now);
    const replacing = { ...ask, summary: "Revised", replaces: old.id };
    const posted = await postNew(owner, replacing, now);
    expect(posted.replaced).toBe(true);
    const before = await storedItems(endpoint, tableName, owner);
    expect(await store.postAsk(owner, replacing, now)).toEqual({
      kind: "matched",
      id: posted.id,
    });
    expect(await storedItems(endpoint, tableName, owner)).toEqual(before);
  });

  it("answers a repeat with the first id even when the account is at its cap", async () => {
    const owner = account();
    const start = new Date("2026-10-11T08:00:00.000Z");
    for (let n = 1; n < dailyAskCap; n += 1) {
      await postNew(owner, numbered(n), new Date(start.getTime() + n * minute));
    }
    const last = new Date(start.getTime() + dailyAskCap * minute);
    const { id } = await postNew(owner, ask, last);
    expect(await store.postAsk(owner, ask, last)).toEqual({
      kind: "matched",
      id,
    });
  }, 20_000);
});

// The counts kept for an account, read straight from the table.
const countsOf = async (owner: AccountId) =>
  (await storedItems(endpoint, tableName, owner)).filter(
    (item) => typeof item.count === "number",
  );

describe("the daily cap", () => {
  it(`takes ${String(dailyAskCap)} asks in a UTC day, refuses the next until midnight, and takes it after`, async () => {
    const owner = account();
    const start = new Date("2026-10-11T00:00:30.000Z");
    for (let n = 0; n < dailyAskCap; n += 1) {
      await postNew(owner, numbered(n), new Date(start.getTime() + n * minute));
    }
    const before = await storedItems(endpoint, tableName, owner);
    const late = new Date("2026-10-11T23:59:59.000Z");
    expect(await store.postAsk(owner, ask, late)).toEqual({
      kind: "over-cap",
      resetsAt: new Date("2026-10-12T00:00:00.000Z"),
    });
    expect(await storedItems(endpoint, tableName, owner)).toEqual(before);
    const midnight = new Date("2026-10-12T00:00:00.000Z");
    expect((await store.postAsk(owner, ask, midnight)).kind).toBe("posted");
  }, 20_000);

  it("keeps the day's count for a few days, then lets the table drop it", async () => {
    const owner = account();
    const now = new Date("2026-10-11T09:30:00.000Z");
    await postNew(owner, ask, now);
    const [daily] = (await countsOf(owner)).filter(
      (item) => item.sk === keys.usage(owner, now).sk,
    );
    expect(daily).toEqual(expect.objectContaining({ count: 1 }));
    const expiresAt = z.number().parse(daily?.expiresAt) * 1000;
    expect(expiresAt).toBeGreaterThan(Date.parse("2026-10-13T00:00:00.000Z"));
    expect(expiresAt).toBeLessThan(Date.parse("2026-10-18T00:00:00.000Z"));
  });

  it(`counts a repeat after ${String(dedupeWindowMinutes)} minutes as a new ask`, async () => {
    const owner = account();
    const now = new Date("2026-10-11T09:30:00.000Z");
    await postNew(owner, ask, now);
    const later = new Date(now.getTime() + dedupeWindowMinutes * minute);
    expect((await store.postAsk(owner, ask, later)).kind).toBe("posted");
    const [daily] = (await countsOf(owner)).filter(
      (item) => item.sk === keys.usage(owner, now).sk,
    );
    expect(daily).toEqual(expect.objectContaining({ count: 2 }));
  });
});

describe("the ask tool's rate counter", () => {
  it(`counts ${String(askLimit.asks)} calls in a minute, refuses the next with the seconds left, and counts afresh the next minute`, async () => {
    const owner = account();
    const start = new Date("2026-10-11T09:30:00.000Z");
    for (let n = 0; n < askLimit.asks; n += 1) {
      expect(
        await store.countAsk(owner, new Date(start.getTime() + n * 1000)),
      ).toEqual({ counted: true });
    }
    expect(
      await store.countAsk(owner, new Date(start.getTime() + 37_500)),
    ).toEqual({ counted: false, secondsLeft: 23 });
    const next = new Date(start.getTime() + minute);
    expect(await store.countAsk(owner, next)).toEqual({ counted: true });
  });

  it("keeps one item a minute, which expires an hour after its minute ends", async () => {
    const owner = account();
    await store.countAsk(owner, new Date("2026-10-11T09:30:20.000Z"));
    await store.countAsk(owner, new Date("2026-10-11T09:30:40.000Z"));
    expect(await storedItems(endpoint, tableName, owner)).toEqual([
      {
        ...keys.askCount(owner, "2026-10-11T09:30"),
        count: 2,
        expiresAt: Date.parse("2026-10-11T10:31:00.000Z") / 1000,
      },
    ]);
  });

  it("leaves the version alone", async () => {
    const owner = account();
    await postNew(owner, ask, new Date());
    await store.countAsk(owner, new Date());
    await store.countAsk(owner, new Date());
    expect(await versionOf(owner)).toBe(1);
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
    const { id } = await postNew(owner, ask, now);
    expect(await store.asksSince(owner, 0, now)).toEqual({
      version: 1,
      everAsked: true,
      asks: [
        {
          id,
          ...ask,
          postedAt: now.toISOString(),
          storedAt: now.toISOString(),
        },
      ],
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

describe("the rules", () => {
  const now = new Date("2026-10-11T09:30:00.000Z");
  const workHours: HashtagWindow = {
    hashtag: "work",
    days: ["mon", "tue", "wed", "thu", "fri"],
    from: "08:00",
    to: "18:00",
  };

  // A new account starts with example rules in the box (PRD, "Rules"),
  // already read, so it costs no model call. They are not saved: the
  // version stays at 0, and nothing is written.
  it("are the example rules, already read, for an account that never saved any", async () => {
    const owner = account();
    expect(await store.rules(owner)).toEqual({
      text: exampleRules.text,
      hashtags: ["work", "shop", "family"],
      seen: ["work", "shop", "family"],
      version: 0,
      readFailed: false,
      hours: [workHours],
    });
    expect(await storedItems(endpoint, tableName, owner)).toEqual([]);
  });

  it("start from the example rules' hashtags, so each keeps its colour after the first save", async () => {
    const owner = account();
    const saved = await store.saveRules(
      owner,
      { text: "#home, then #work.", hashtags: ["home", "work"] },
      now,
    );
    expect(saved).toMatchObject({
      hashtags: ["home", "work"],
      seen: ["work", "shop", "family", "home"],
      version: 1,
    });
    expect(saved.hours).toBeUndefined();
  });

  it("keep the text, the hashtags read from it and when they were saved, and raise the version", async () => {
    const owner = account();
    const saved = await store.saveRules(
      owner,
      { text: "#work first, then #shop.", hashtags: ["work", "shop"] },
      now,
    );
    expect(saved).toEqual({
      text: "#work first, then #shop.",
      hashtags: ["work", "shop"],
      seen: ["work", "shop", "family"],
      version: 1,
      readFailed: false,
      savedAt: now.toISOString(),
    });
    expect(await store.rules(owner)).toEqual(saved);
    expect(await versionOf(owner)).toBe(1);
  });

  it("keep each hashtag's hours, read with it, and the time zone they use", async () => {
    const owner = account();
    const saved = await store.saveRules(
      owner,
      {
        text: "#work on weekdays, 8am to 6pm. #shop at any time.",
        timeZone: "Europe/London",
        hashtags: ["work", "shop"],
        hours: [workHours],
      },
      now,
    );
    expect(saved).toMatchObject({
      hashtags: ["work", "shop"],
      hours: [workHours],
      timeZone: "Europe/London",
    });
    expect(await store.rules(owner)).toEqual(saved);
  });

  it("keep the old hours, and take the new time zone, when the rules could not be read", async () => {
    const owner = account();
    await store.saveRules(
      owner,
      {
        text: "#work on weekdays, 8am to 6pm.",
        timeZone: "Europe/London",
        hashtags: ["work"],
        hours: [workHours],
      },
      now,
    );
    const saved = await store.saveRules(
      owner,
      { text: "#work on weekdays, 9 to 5.", timeZone: "America/New_York" },
      now,
    );
    expect(saved).toMatchObject({
      hashtags: ["work"],
      hours: [workHours],
      timeZone: "America/New_York",
      readFailed: true,
    });
  });

  it("drop the old hours when the new rules give none", async () => {
    const owner = account();
    await store.saveRules(
      owner,
      { text: "#work on weekdays.", hashtags: ["work"], hours: [workHours] },
      now,
    );
    const saved = await store.saveRules(
      owner,
      { text: "#work at any time.", hashtags: ["work"] },
      now,
    );
    expect(saved.hours).toBeUndefined();
    expect((await store.rules(owner)).hours).toBeUndefined();
  });

  it("keep the time zone saved before when a save gives none", async () => {
    const owner = account();
    await store.saveRules(
      owner,
      { text: "#work", timeZone: "Asia/Tokyo", hashtags: ["work"] },
      now,
    );
    const saved = await store.saveRules(
      owner,
      { text: "#work first.", hashtags: ["work"] },
      now,
    );
    expect(saved.timeZone).toBe("Asia/Tokyo");
  });

  it("keep the new text and the old hashtags when the rules could not be read", async () => {
    const owner = account();
    await store.saveRules(
      owner,
      { text: "#work first.", hashtags: ["work"] },
      now,
    );
    const saved = await store.saveRules(
      owner,
      { text: "#work first, then #family." },
      now,
    );
    expect(saved).toEqual({
      text: "#work first, then #family.",
      hashtags: ["work"],
      seen: ["work", "shop", "family"],
      version: 2,
      readFailed: true,
      savedAt: now.toISOString(),
    });
    expect(await versionOf(owner)).toBe(2);
  });

  it("remember every hashtag in the order it first appeared, so its colour stays", async () => {
    const owner = account();
    await store.saveRules(
      owner,
      { text: "#work, #shop", hashtags: ["work", "shop"] },
      now,
    );
    await store.saveRules(owner, { text: "", hashtags: [] }, now);
    const saved = await store.saveRules(
      owner,
      { text: "#family, #shop, #work", hashtags: ["family", "shop", "work"] },
      now,
    );
    expect(saved.hashtags).toEqual(["family", "shop", "work"]);
    expect(saved.seen).toEqual(["work", "shop", "family"]);
  });

  // Two hashtags the example rules do not name, so each is new to the
  // account.
  it("lose no hashtag when two saves arrive together", async () => {
    const owner = account();
    await Promise.all([
      store.saveRules(owner, { text: "#garden", hashtags: ["garden"] }, now),
      store.saveRules(owner, { text: "#travel", hashtags: ["travel"] }, now),
    ]);
    const rules = await store.rules(owner);
    expect(rules.version).toBe(2);
    expect([...rules.seen].sort()).toEqual([
      "family",
      "garden",
      "shop",
      "travel",
      "work",
    ]);
  });
});

describe("a sort result", () => {
  const now = new Date("2026-10-11T09:30:00.000Z");
  const sort = {
    hashtags: ["work"],
    level: "high" as const,
    reason: "The electrician is waiting.",
    rulesVersion: 1,
  };

  it("is stored on the open ask, and the list shows it", async () => {
    const owner = account();
    const { id } = await postNew(owner, ask, now);
    expect(await store.recordSort(owner, id, sort, now)).toBe(true);
    expect((await store.openAsks(owner, now)).asks).toEqual([
      {
        id,
        ...ask,
        postedAt: now.toISOString(),
        storedAt: now.toISOString(),
        sort: { ...sort, sortedAt: now.toISOString() },
      },
    ]);
    expect(await versionOf(owner)).toBe(2);
  });

  it("changes nothing when the ask has closed", async () => {
    const owner = account();
    const { id } = await postNew(owner, ask, now);
    await store.resolveAsk(owner, id, now);
    const before = await storedItems(endpoint, tableName, owner);
    expect(await store.recordSort(owner, id, sort, now)).toBe(false);
    expect(await storedItems(endpoint, tableName, owner)).toEqual(before);
  });

  it("changes nothing for an id the account has no ask for", async () => {
    const owner = account();
    expect(await store.recordSort(owner, "no-such-ask", sort, now)).toBe(false);
    expect(await storedItems(endpoint, tableName, owner)).toEqual([]);
  });

  it("does not replace a sort made with newer rules", async () => {
    const owner = account();
    const { id } = await postNew(owner, ask, now);
    await store.recordSort(owner, id, { ...sort, rulesVersion: 3 }, now);
    expect(
      await store.recordSort(
        owner,
        id,
        { ...sort, level: "low", rulesVersion: 2 },
        now,
      ),
    ).toBe(false);
    const [stored] = (await store.openAsks(owner, now)).asks;
    expect(stored?.sort?.rulesVersion).toBe(3);
  });
});

describe("an ask to sort", () => {
  const now = new Date("2026-10-11T09:30:00.000Z");

  it("is the open ask with the account's rules", async () => {
    const owner = account();
    const rules = await store.saveRules(
      owner,
      { text: "#work", hashtags: ["work"] },
      now,
    );
    const { id } = await postNew(owner, ask, now);
    expect(await store.askToSort(owner, id, now)).toEqual({
      ask: {
        id,
        ...ask,
        postedAt: now.toISOString(),
        storedAt: now.toISOString(),
      },
      rules,
    });
  });

  it("is nothing when the ask has closed, or was never posted", async () => {
    const owner = account();
    const { id } = await postNew(owner, ask, now);
    await store.resolveAsk(owner, id, now);
    expect(await store.askToSort(owner, id, now)).toBeUndefined();
    expect(await store.askToSort(owner, "no-such-ask", now)).toBeUndefined();
  });
});

describe.each([
  [
    "saving the rules",
    rulesSaveLimit.saves,
    "countRulesSave",
    "rulesSaveCount",
  ],
  [
    "retrying a sort",
    sortRetryLimit.retries,
    "countSortRetry",
    "sortRetryCount",
  ],
] as const)("the rate counter for %s", (_, limit, method, key) => {
  const minute = new Date("2026-10-11T09:30:10.000Z");

  it("counts up to the limit in a minute, then refuses with the seconds left", async () => {
    const owner = account();
    for (let n = 0; n < limit; n += 1) {
      expect(await store[method](owner, minute)).toEqual({ counted: true });
    }
    expect(await store[method](owner, minute)).toEqual({
      counted: false,
      secondsLeft: 50,
    });
  });

  it("keeps one item a minute under its own prefix, and leaves the version alone", async () => {
    const owner = account();
    await store[method](owner, minute);
    expect(await storedItems(endpoint, tableName, owner)).toEqual([
      {
        ...keys[key](owner, "2026-10-11T09:30"),
        count: 1,
        expiresAt: Date.parse("2026-10-11T10:31:00.000Z") / 1000,
      },
    ]);
    expect(await versionOf(owner)).toBe(0);
  });
});
