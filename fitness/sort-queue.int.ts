import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
} from "vitest";
import { z } from "zod";
import { handler } from "../service/src/handler";
import { callerOf, type AccountId } from "../service/src/identity";
import { handler as sorter, sortDeliveries } from "../service/src/sorter";
import { sortKeys } from "../service/src/store/keys";
import { createStore, type NewAsk } from "../service/src/store/store";
import { sortingMs } from "../service/src/view";
import { pagePaths } from "../shared/page-api";
import { storedItems } from "../test/dynamodb";
import { fakes } from "../test/fakes";
import { startFakeIssuer, type FakeIssuer } from "../test/identity";
import { invoke } from "../test/lambda";
import { captureLogs, type Captured } from "../test/logs";
import { connect, origin } from "../test/mcp";
import { noon, startClockAt } from "../test/clock";
import { setModelCalls } from "../test/model-cap";

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

const accountId = (sub: string): AccountId =>
  callerOf({
    token: "test",
    clientId: "test",
    scopes: [],
    extra: { accountId: sub, requestId: "r" },
  }).accountId;

const minute = 60_000;

const deliver = () =>
  fakes.queue.deliver((event) => sorter(event, { awsRequestId: "sort-1" }));

const ask = {
  summary: "Approve the plan for the kitchen rewiring",
  area: "Home renovation",
  spoken_detail: "The electrician needs a yes or no before Friday.",
};

async function post(sub: string, args: Record<string, string> = ask) {
  const client = await connect(handler, {
    token: await issuer.token({ claims: { sub } }),
  });
  try {
    const result = await client.callTool({ name: "ask", arguments: args });
    return z.object({ id: z.string() }).parse(result.structuredContent).id;
  } finally {
    await client.close();
  }
}

// Straight to the store, so nothing is queued for it, as when its job was
// lost.
async function postEarlier(sub: string, newAsk: NewAsk, at: Date) {
  const posting = await store.postAsk(accountId(sub), newAsk, at);
  if (posting.kind !== "posted") throw new Error("Not posted.");
  return posting.id;
}

const saveRules = async (sub: string, text: string) =>
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

async function saveRead(sub: string, text: string, hashtags: string[]) {
  fakes.model.reply({ json: { hashtags, hours: [] } });
  const response = await saveRules(sub, text);
  expect(response.status).toBe(200);
}

// sortingUntil is when an ask behind the rules turns stopped.
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
      asks: z.array(
        z.object({
          id: z.string(),
          sort: z.object({ hashtags: z.array(z.string()) }).nullable(),
          sortingUntil: z.string().optional(),
        }),
      ),
    })
    .parse(await response.json());
}

const sortingUntil = async (sub: string, id: string) =>
  (await listed(sub)).asks.find((one) => one.id === id)?.sortingUntil;

const sentSince = (from: number, sub: string) =>
  fakes.queue.sent
    .slice(from)
    .filter(
      (message) =>
        z.object({ accountId: z.literal(sub) }).safeParse(message.body).success,
    );

const queueAnswer = z.object({
  batchItemFailures: z.array(z.object({ itemIdentifier: z.string() })),
});

const sorted = (hashtags: string[]) => ({
  json: { hashtags, level: "normal", reason: "Routine." },
});

describe("fitness: a poll queues nothing (sort-queue.md)", () => {
  it("sends nothing for asks behind the rules, sorting or stopped", async () => {
    const sub = newAccount();
    const owner = accountId(sub);
    await store.saveRules(
      owner,
      { text: "#work first.", hashtags: ["work"] },
      new Date(Date.now() - 50 * minute),
    );
    const stopped = await postEarlier(
      sub,
      { summary: "Stopped", area: "Work", spokenDetail: "Stopped." },
      new Date(Date.now() - 40 * minute),
    );
    const sorting = await postEarlier(
      sub,
      { summary: "Sorting", area: "Work", spokenDetail: "Sorting." },
      new Date(Date.now() - 2 * minute),
    );
    const from = fakes.queue.sent.length;
    const { asks } = await listed(sub);
    expect(asks.map(({ id }) => id).sort()).toEqual([stopped, sorting].sort());
    expect(asks.every(({ sort }) => sort === null)).toBe(true);
    await listed(sub);
    expect(fakes.queue.sent.slice(from)).toEqual([]);
  });
});

describe("fitness: an up-to-date job makes no call (sort-queue.md)", () => {
  it("sorts an ask once, with the newest rules, after two saves close together", async () => {
    const sub = newAccount();
    await saveRead(sub, "#work first.", ["work"]);
    const id = await post(sub);
    fakes.model.reply(sorted(["work"]));
    await deliver();
    await saveRead(sub, "#work, then #home.", ["work", "home"]);
    await saveRead(sub, "#home first, then #work.", ["home", "work"]);
    expect(fakes.queue.waiting()).toBe(2);
    const calls = fakes.model.calls.length;
    fakes.model.reply(sorted(["home"]));
    expect(await deliver()).toBe(2);
    expect(fakes.model.calls).toHaveLength(calls + 1);
    expect(JSON.stringify(fakes.model.calls.at(-1)?.body)).toContain(
      "#home first, then #work.",
    );
    expect((await listed(sub)).asks).toEqual([
      { id, sort: { hashtags: ["home"] } },
    ]);
  });
});

describe("fitness: each send has its own id (sort-queue.md)", () => {
  it("gives sends for one ask from different saves, a save of unchanged text included, different ids", async () => {
    const sub = newAccount();
    await saveRead(sub, "#work first.", ["work"]);
    const id = await post(sub);
    const from = fakes.queue.sent.length;
    await saveRead(sub, "#work, then #home.", ["work", "home"]);
    // Unchanged, after a reading that succeeded: it queues the ask again,
    // which is still behind the rules.
    expect((await saveRules(sub, "#work, then #home.")).status).toBe(200);
    const sends = sentSince(from, sub);
    expect(sends).toHaveLength(2);
    expect(sends.map(({ groupId }) => groupId)).toEqual([id, id]);
    expect(sends[0]?.deduplicationId).not.toBe(sends[1]?.deduplicationId);
    expect(sends.every(({ taken }) => taken)).toBe(true);
  });

  it("gives a repeat of one send the same id, so the queue drops it", async () => {
    const sub = newAccount();
    const from = fakes.queue.sent.length;
    fakes.queue.loseAnswers(1);
    const id = await post(sub);
    const sends = sentSince(from, sub);
    expect(sends.map(({ groupId, taken }) => ({ groupId, taken }))).toEqual([
      { groupId: id, taken: true },
      { groupId: id, taken: false },
    ]);
    expect(sends[1]?.deduplicationId).toBe(sends[0]?.deduplicationId);
    expect(fakes.queue.waiting()).toBe(1);
  });

  it("puts each ask's jobs in its own group, ten to a call", async () => {
    const sub = newAccount();
    await saveRead(sub, "#work first.", ["work"]);
    const ids: string[] = [];
    for (let place = 0; place < 12; place++) {
      ids.push(
        await postEarlier(
          sub,
          { summary: `Ask ${String(place)}`, area: "Work", spokenDetail: "." },
          new Date(),
        ),
      );
    }
    const calls = fakes.queue.calls.length;
    const from = fakes.queue.sent.length;
    await saveRead(sub, "#work, then #home.", ["work", "home"]);
    expect(fakes.queue.calls.slice(calls).sort()).toEqual([10, 2].sort());
    expect(
      sentSince(from, sub)
        .map(({ groupId }) => groupId)
        .sort(),
    ).toEqual(ids.sort());
  });
});

describe("fitness: a failed sort never fails the run (sort-queue.md)", () => {
  let capture: { lines: Captured[]; restore(): void };
  beforeEach(() => {
    capture = captureLogs();
  });
  afterEach(() => {
    capture.restore();
  });
  const lines = () =>
    capture.lines.map(({ method, args }) => ({
      level: method,
      ...z.record(z.string(), z.unknown()).parse(args[0]),
    }));

  it("reports the message as failed and does not throw, then lets it go on the third delivery with one warn line", async () => {
    const sub = newAccount();
    await saveRead(sub, "#work first.", ["work"]);
    const id = await post(sub);
    const answers: unknown[] = [];
    const run = (event: unknown) =>
      sorter(event, { awsRequestId: "sort-1" }).then((answer) => {
        answers.push(answer);
        return answer;
      });
    for (let delivery = 1; delivery <= sortDeliveries; delivery++) {
      fakes.model.reply({ status: 503 }, { status: 503 });
      expect(await fakes.queue.deliver(run)).toBe(1);
      expect(fakes.queue.waiting()).toBe(delivery < sortDeliveries ? 1 : 0);
    }
    // Each run answered, and only the last left the message to be deleted.
    expect(
      answers.map(
        (answer) => queueAnswer.parse(answer).batchItemFailures.length,
      ),
    ).toEqual([1, 1, 0]);
    const warned = lines().filter(({ level }) => level === "warn");
    expect(warned).toEqual([
      expect.objectContaining({
        event: "sort-failed",
        accountId: sub,
        askId: id,
      }),
    ]);
    expect(lines().filter(({ level }) => level === "error")).toEqual([]);
    expect((await listed(sub)).asks).toEqual([
      expect.objectContaining({ id, sort: null }),
    ]);
  });
});

describe("fitness: stopped is worked out, not written (sort-queue.md)", () => {
  it("gives an ask behind the rules the time it turns stopped: half an hour after it was stored, or after the last save when that is later", async () => {
    const sub = newAccount();
    const owner = accountId(sub);
    const savedAt = new Date(Date.now() - 20 * minute);
    await store.saveRules(
      owner,
      { text: "#work first.", hashtags: ["work"] },
      savedAt,
    );
    const storedEarlier = new Date(Date.now() - 40 * minute);
    const before = await postEarlier(
      sub,
      { summary: "Before", area: "Work", spokenDetail: "Before." },
      storedEarlier,
    );
    const storedLater = new Date(Date.now() - 10 * minute);
    const after = await postEarlier(
      sub,
      { summary: "After", area: "Work", spokenDetail: "After." },
      storedLater,
    );
    expect(await sortingUntil(sub, before)).toBe(
      new Date(savedAt.getTime() + sortingMs).toISOString(),
    );
    expect(await sortingUntil(sub, after)).toBe(
      new Date(storedLater.getTime() + sortingMs).toISOString(),
    );
  });

  it("gives an ask sorted with the rules in force no such time", async () => {
    const sub = newAccount();
    await saveRules(sub, "");
    const id = await post(sub);
    expect(await sortingUntil(sub, id)).toBeDefined();
    await deliver();
    const [listedAsk] = (await listed(sub)).asks;
    expect(listedAsk?.id).toBe(id);
    expect(listedAsk?.sort).not.toBeNull();
    expect(listedAsk).not.toHaveProperty("sortingUntil");
  });

  it("judges a replacing ask by when it was stored, not by the posting time it keeps", async () => {
    const sub = newAccount();
    const old = await postEarlier(
      sub,
      { summary: "Old", area: "Work", spokenDetail: "Old." },
      new Date(Date.now() - 40 * minute),
    );
    const posted = Date.now();
    const id = await post(sub, { ...ask, replaces: old });
    const until = Date.parse((await sortingUntil(sub, id)) ?? "");
    expect(until).toBeGreaterThanOrEqual(posted + sortingMs);
    expect(until).toBeLessThan(Date.now() + sortingMs + minute);
  });

  it("writes nothing as an ask passes from sorting to stopped", async () => {
    const sub = newAccount();
    const id = await postEarlier(
      sub,
      { summary: "Lost", area: "Work", spokenDetail: "Lost." },
      new Date(Date.now() - 40 * minute),
    );
    const until = await sortingUntil(sub, id);
    expect(Date.parse(until ?? "")).toBeLessThan(Date.now());
    const items = async () =>
      (await storedItems(endpoint, tableName, sub)).filter(
        ({ sk }) =>
          typeof sk === "string" && !sk.startsWith(sortKeys.pollCount),
      );
    const kept = await items();
    const { version } = await listed(sub);
    expect(await sortingUntil(sub, id)).toBe(until);
    expect((await listed(sub)).version).toBe(version);
    expect(await items()).toEqual(kept);
  });
});

describe("fitness: an unchanged save calls no model (sort-queue.md)", () => {
  it("leaves the rules version alone, reads nothing, and queues only the asks behind the rules", async () => {
    const sub = newAccount();
    const owner = accountId(sub);
    await saveRead(sub, "#work first.", ["work"]);
    await deliver();
    const current = await post(sub);
    fakes.model.reply(sorted(["work"]));
    await deliver();
    const behind = await postEarlier(
      sub,
      { summary: "Behind", area: "Work", spokenDetail: "Behind." },
      new Date(Date.now() - 40 * minute),
    );
    const rulesBefore = await store.rules(owner);
    const calls = fakes.model.calls.length;
    const from = fakes.queue.sent.length;
    const response = await saveRules(sub, "#work first.");
    expect(response.status).toBe(200);
    expect(fakes.model.calls).toHaveLength(calls);
    const rulesAfter = await store.rules(owner);
    expect(rulesAfter.version).toBe(rulesBefore.version);
    expect(Date.parse(rulesAfter.savedAt ?? "")).toBeGreaterThan(
      Date.parse(rulesBefore.savedAt ?? ""),
    );
    expect(sentSince(from, sub).map(({ groupId }) => groupId)).toEqual([
      behind,
    ]);
    expect(await sortingUntil(sub, current)).toBeUndefined();
    expect(Date.parse((await sortingUntil(sub, behind)) ?? "")).toBe(
      Date.parse(rulesAfter.savedAt ?? "") + sortingMs,
    );
  });

  it("is refused with cap_reached while the cap is spent, and saves and queues nothing", async () => {
    startClockAt(noon);
    const sub = newAccount();
    const owner = accountId(sub);
    await saveRead(sub, "#work first.", ["work"]);
    await postEarlier(
      sub,
      { summary: "Behind", area: "Work", spokenDetail: "Behind." },
      new Date(Date.now() - 40 * minute),
    );
    const rulesBefore = await store.rules(owner);
    await setModelCalls(owner);
    const from = fakes.queue.sent.length;
    const response = await saveRules(sub, "#work first.");
    expect(response.status).toBe(429);
    expect(z.object({ code: z.string() }).parse(await response.json())).toEqual(
      { code: "cap_reached" },
    );
    expect(await store.rules(owner)).toEqual(rulesBefore);
    expect(sentSince(from, sub)).toEqual([]);
  });

  it("still queues the asks behind the rules while the cap is spent when the text is empty", async () => {
    startClockAt(noon);
    const sub = newAccount();
    expect((await saveRules(sub, "")).status).toBe(200);
    const behind = await postEarlier(
      sub,
      { summary: "Behind", area: "Work", spokenDetail: "Behind." },
      new Date(Date.now() - 40 * minute),
    );
    await setModelCalls(accountId(sub));
    const from = fakes.queue.sent.length;
    expect((await saveRules(sub, "")).status).toBe(200);
    expect(sentSince(from, sub).map(({ groupId }) => groupId)).toEqual([
      behind,
    ]);
  });

  it("reads the rules again when their last reading failed, as Try again does", async () => {
    const sub = newAccount();
    const owner = accountId(sub);
    fakes.model.reply({ status: 503 });
    expect((await saveRules(sub, "#work first.")).status).toBe(200);
    const { version } = await store.rules(owner);
    const calls = fakes.model.calls.length;
    await saveRead(sub, "#work first.", ["work"]);
    expect(fakes.model.calls).toHaveLength(calls + 1);
    expect((await store.rules(owner)).version).toBe(version + 1);
  });
});
