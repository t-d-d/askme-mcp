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
import { modelCallLimit } from "../service/src/rate";
import { handler as sorter } from "../service/src/sorter";
import { createStore } from "../service/src/store/store";
import { pagePaths } from "../shared/page-api";
import { fakes } from "../test/fakes";
import { startFakeIssuer, type FakeIssuer } from "../test/identity";
import { invoke } from "../test/lambda";
import { captureLogs, type Captured } from "../test/logs";
import { connect, origin } from "../test/mcp";
import { noon, startClockAt } from "../test/clock";
import { modelCallsMade, nextReset, setModelCalls } from "../test/model-cap";

let issuer: FakeIssuer;
beforeAll(async () => {
  issuer = await startFakeIssuer();
  vi.stubEnv("CLERK_ISSUER", issuer.issuer);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await issuer.close();
});

// Each test starts with an empty queue, whatever an earlier one left, and
// at noon UTC, far from the end of the day the cap counts in.
beforeEach(() => {
  fakes.queue.purge();
  startClockAt(noon);
});

let capture: { lines: Captured[]; restore(): void };
beforeEach(() => {
  capture = captureLogs();
});
afterEach(() => {
  capture.restore();
});

// Each line logged, with its level.
const lines = () =>
  capture.lines.map(({ method, args }) => ({
    level: method,
    ...z.record(z.string(), z.unknown()).parse(args[0]),
  }));

const newAccount = () => `user_${randomUUID().slice(0, 8)}`;

const accountId = (sub: string): AccountId =>
  callerOf({
    token: "test",
    clientId: "test",
    scopes: [],
    extra: { accountId: sub, requestId: "r" },
  }).accountId;

// Delivers the jobs waiting on the queue, as Lambda's trigger would.
const deliver = () =>
  fakes.queue.deliver((event) => sorter(event, { awsRequestId: "sort-1" }));

const ask = {
  summary: "Approve the plan for the kitchen rewiring",
  area: "Home renovation",
  spoken_detail: "The electrician needs a yes or no before Friday.",
};

// Posts an ask as an agent, and gives the tool's answer.
async function post(sub: string, summary = ask.summary) {
  const client = await connect(handler, {
    token: await issuer.token({ claims: { sub } }),
  });
  try {
    const result = await client.callTool({
      name: "ask",
      arguments: { ...ask, summary },
    });
    return {
      isError: result.isError === true,
      id: z.object({ id: z.string() }).parse(result.structuredContent).id,
    };
  } finally {
    await client.close();
  }
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

// Saves the rules, with the model reading the hashtags given.
async function saveRead(sub: string, text: string, hashtags: string[]) {
  fakes.model.reply({ json: { hashtags, hours: [] } });
  expect((await saveRules(sub, text)).status).toBe(200);
}

// The list as the page reads it: the version, when the cap resets while it
// is spent, and each ask's sort.
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
      modelCapResetsAt: z.string().optional(),
      asks: z.array(
        z.object({
          id: z.string(),
          sort: z.object({ hashtags: z.array(z.string()) }).nullable(),
        }),
      ),
    })
    .parse(await response.json());
}

const refusalSchema = z.strictObject({
  code: z.string(),
  class: z.string(),
  message: z.string(),
});

const sorted = (hashtags: string[]) => ({
  json: { hashtags, level: "normal", reason: "Routine." },
});

const store = createStore({
  tableName: inject("tableName"),
  endpoint: inject("databaseEndpoint"),
});
afterAll(() => {
  store.close();
});

describe("fitness: a spent cap sends no call (model-call-cap.md)", () => {
  it("refuses a save whose rules need reading with cap_reached, and saves none of the rules", async () => {
    const sub = newAccount();
    const owner = accountId(sub);
    await saveRead(sub, "#work first.", ["work"]);
    const before = await store.rules(owner);
    await setModelCalls(owner);
    const calls = fakes.model.calls.length;
    const sent = fakes.queue.sent.length;
    const response = await saveRules(sub, "#home first, then #work.");
    expect(response.status).toBe(429);
    const refusal = refusalSchema.parse(await response.json());
    expect(refusal.code).toBe("cap_reached");
    expect(refusal.class).toBe("do not retry");
    expect(refusal.message).toContain(String(modelCallLimit.calls));
    expect(refusal.message).toContain(nextReset());
    expect(fakes.model.calls).toHaveLength(calls);
    expect(fakes.queue.sent).toHaveLength(sent);
    expect(await store.rules(owner)).toEqual(before);
    expect(lines()).toContainEqual(
      expect.objectContaining({
        level: "info",
        event: "rules-capped",
        accountId: sub,
      }),
    );
  });

  it("takes an agent's ask, and its sort sends no call, leaves the asks as they were, and logs at info", async () => {
    const sub = newAccount();
    await saveRead(sub, "#work first.", ["work"]);
    const first = await post(sub, "First");
    fakes.model.reply(sorted(["work"]));
    await deliver();
    await setModelCalls(accountId(sub));
    const calls = fakes.model.calls.length;
    const second = await post(sub, "Second");
    expect(second.isError).toBe(false);
    capture.lines.length = 0;
    expect(await deliver()).toBe(1);
    expect(fakes.model.calls).toHaveLength(calls);
    expect(fakes.queue.waiting()).toBe(0);
    const { asks } = await listed(sub);
    expect(asks.find(({ id }) => id === first.id)?.sort).toEqual({
      hashtags: ["work"],
    });
    expect(asks.find(({ id }) => id === second.id)?.sort).toBeNull();
    expect(lines()).toContainEqual(
      expect.objectContaining({
        level: "info",
        event: "sort-capped",
        accountId: sub,
        askId: second.id,
      }),
    );
    expect(lines().filter(({ level }) => level !== "info")).toEqual([]);
  });

  it("saves an empty box, which needs no call, and sorts the asks with no call", async () => {
    const sub = newAccount();
    const id = (await post(sub)).id;
    fakes.queue.purge();
    await setModelCalls(accountId(sub));
    const calls = fakes.model.calls.length;
    expect((await saveRules(sub, "")).status).toBe(200);
    await deliver();
    expect(fakes.model.calls).toHaveLength(calls);
    expect((await listed(sub)).asks).toEqual([{ id, sort: { hashtags: [] } }]);
  });
});

describe("fitness: each call counts once (model-call-cap.md)", () => {
  it("counts as many calls as the model received, after posts, saves, a sort whose first try fails, and jobs skipped as up to date", async () => {
    const sub = newAccount();
    const calls = fakes.model.calls.length;
    await saveRead(sub, "#work first.", ["work"]);
    await post(sub, "First");
    await post(sub, "Second");
    fakes.model.reply({ status: 503 }, sorted(["work"]), sorted(["work"]));
    await deliver();
    // Two saves close together queue two jobs for each ask. The first job
    // sorts it, and the second finds it up to date and makes no call.
    await saveRead(sub, "#work, then #home.", ["work", "home"]);
    await saveRead(sub, "#home first, then #work.", ["home", "work"]);
    fakes.model.reply(sorted(["home"]), sorted(["work"]));
    expect(await deliver()).toBe(4);
    // Three readings, the first ask's two tries, the second ask's one, and
    // one try for each ask after the saves.
    const received = fakes.model.calls.length - calls;
    expect(received).toBe(8);
    expect(await modelCallsMade(accountId(sub))).toBe(received);
  });
});

describe("fitness: the first refusal in a day records when the cap resets (model-call-cap.md)", () => {
  it("raises the version once for the first call the cap refuses, and never for a count", async () => {
    const sub = newAccount();
    const owner = accountId(sub);
    await saveRead(sub, "#work first.", ["work"]);
    await post(sub);
    const { version } = await listed(sub);
    // Two calls counted, and nothing written but the count.
    fakes.model.reply({ status: 503 }, { status: 503 });
    await deliver();
    fakes.queue.purge();
    expect(await modelCallsMade(owner)).toBe(3);
    expect((await listed(sub)).version).toBe(version);
    await setModelCalls(owner);
    expect((await saveRules(sub, "#home first.")).status).toBe(429);
    const refused = await listed(sub);
    expect(refused.version).toBe(version + 1);
    expect(refused.modelCapResetsAt).toBe(nextReset());
    expect((await saveRules(sub, "#home first.")).status).toBe(429);
    await post(sub, "Another");
    await deliver();
    const after = await listed(sub);
    // Posting raised it once more, and nothing else did.
    expect(after.version).toBe(version + 2);
    expect(after.modelCapResetsAt).toBe(nextReset());
  });

  it("records it when a sort is the first call refused", async () => {
    const sub = newAccount();
    await post(sub);
    await setModelCalls(accountId(sub));
    const before = await listed(sub);
    expect(before.modelCapResetsAt).toBeUndefined();
    expect(await deliver()).toBe(1);
    const after = await listed(sub);
    expect(after.version).toBe(before.version + 1);
    expect(after.modelCapResetsAt).toBe(nextReset());
  });
});
