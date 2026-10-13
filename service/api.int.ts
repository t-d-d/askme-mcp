import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  inject,
  it,
  onTestFinished,
  vi,
} from "vitest";
import { z } from "zod";
import {
  askChangePaths,
  pagePaths,
  rulesLimit,
  samplesPath,
  timeZoneLimit,
} from "../shared/page-api";
import { noon, stopClockAt } from "../test/clock";
import { storedItems } from "../test/dynamodb";
import { fakes, modelKeyParameter, testModelKey } from "../test/fakes";
import { runSorts } from "../test/sorts";
import { startFakeIssuer, type FakeIssuer } from "../test/identity";
import { invoke, type LambdaHandler } from "../test/lambda";
import { captureLogs, lineText } from "../test/logs";
import { connect, origin } from "../test/mcp";
import { handler } from "./src/handler";
import { callerOf } from "./src/identity";
import { sortRequestTimeoutMs } from "./src/jobs";
import { rateLimits } from "./src/rate";
import { exampleRules } from "./src/rules";
import { sampleAreas } from "./src/samples";
import { handler as sorter } from "./src/sorter";
import {
  createStore,
  dailyAskCap,
  dedupeWindowMinutes,
  type NewAsk,
} from "./src/store/store";
import { sortingMs } from "./src/view";

let issuer: FakeIssuer;
beforeAll(async () => {
  issuer = await startFakeIssuer();
  vi.stubEnv("CLERK_ISSUER", issuer.issuer);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await issuer.close();
});

// Every test file shares the table, so each test makes its own account.
const newAccount = () => `user_${randomUUID().slice(0, 8)}`;

const get = (path: string, token?: string) =>
  invoke(
    handler,
    new Request(`${origin}${path}`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    }),
  );

const ask = {
  summary: "Approve the plan for the kitchen rewiring",
  area: "Home renovation",
  spoken_detail: "The electrician needs a yes or no before Friday.",
  action_link: "https://github.com/t-d-d/askme-mcp/pull/1",
};

async function call(
  account: string,
  name: string,
  args: Record<string, string | number>,
): Promise<unknown> {
  const client = await connect(handler, {
    token: await issuer.token({ claims: { sub: account } }),
  });
  try {
    return (await client.callTool({ name, arguments: args })).structuredContent;
  } finally {
    await client.close();
  }
}

async function post(
  account: string,
  args: Record<string, string | number> = ask,
): Promise<string> {
  return z.object({ id: z.string() }).parse(await call(account, "ask", args))
    .id;
}

async function list(account: string) {
  const response = await get(
    pagePaths.asks,
    await issuer.sessionToken({ claims: { sub: account } }),
  );
  return z
    .object({
      version: z.number(),
      asks: z.array(z.object({ id: z.string(), postedAt: z.string() })),
    })
    .parse(await response.json());
}

const refusalSchema = z.strictObject({
  code: z.string(),
  class: z.string(),
  message: z.string(),
});

const exampleHashtags = [
  {
    name: "work",
    colour: 0,
    hours: [
      {
        days: ["mon", "tue", "wed", "thu", "fri"],
        from: "08:00",
        to: "18:00",
      },
    ],
  },
  { name: "shop", colour: 1 },
  { name: "family", colour: 2 },
];

describe("the list of open asks", () => {
  it("is empty for a new account, which has never had an ask, and carries the example rules' hashtags", async () => {
    const response = await get(
      pagePaths.asks,
      await issuer.sessionToken({ claims: { sub: newAccount() } }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      version: 0,
      everAsked: false,
      hashtags: exampleHashtags,
      formerHashtags: [],
      asks: [],
    });
  });

  it("holds what an agent posted, under the id the agent got back", async () => {
    const account = newAccount();
    const before = Date.now();
    const id = await post(account);
    const response = await get(
      pagePaths.asks,
      await issuer.sessionToken({ claims: { sub: account } }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const answer = z
      .object({
        version: z.number(),
        everAsked: z.boolean(),
        asks: z.array(
          z.looseObject({ postedAt: z.string(), sortingUntil: z.string() }),
        ),
      })
      .parse(await response.json());
    expect(answer.version).toBe(1);
    expect(answer.everAsked).toBe(true);
    const [listed] = answer.asks;
    const {
      postedAt: posted,
      sortingUntil: until,
      ...rest
    } = listed ?? { postedAt: "", sortingUntil: "" };
    expect(answer.asks).toHaveLength(1);
    expect(rest).toEqual({
      id,
      summary: ask.summary,
      spokenDetail: ask.spoken_detail,
      actionLink: ask.action_link,
      opened: false,
      sort: null,
    });
    const postedAt = Date.parse(posted);
    expect(postedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(postedAt).toBeLessThanOrEqual(Date.now());
    expect(Date.parse(until)).toBe(postedAt + sortingMs);
  });

  it("holds both of an ask's links, and leaves out one the agent did not send", async () => {
    const account = newAccount();
    const both = await post(account, {
      ...ask,
      session_link: "https://claude.ai/code/session_1",
    });
    const neither = await post(account, {
      summary: "Which date format should the export use?",
      area: ask.area,
      spoken_detail: ask.spoken_detail,
    });
    const response = await get(
      pagePaths.asks,
      await issuer.sessionToken({ claims: { sub: account } }),
    );
    const { asks } = z
      .object({ asks: z.array(z.looseObject({ id: z.string() })) })
      .parse(await response.json());
    expect(asks.find((listed) => listed.id === both)).toMatchObject({
      actionLink: ask.action_link,
      sessionLink: "https://claude.ai/code/session_1",
    });
    const bare = asks.find((listed) => listed.id === neither);
    expect(bare).toBeDefined();
    expect(bare).not.toHaveProperty("actionLink");
    expect(bare).not.toHaveProperty("sessionLink");
  });

  it("drops an ask once its agent resolves it", async () => {
    const account = newAccount();
    const id = await post(account);
    await call(account, "resolve", { id });
    expect(await list(account)).toEqual({ version: 2, asks: [] });
  });

  it("holds a new ask in place of the one it replaces, waiting since the first", async () => {
    const account = newAccount();
    const old = await post(account);
    const [first] = (await list(account)).asks;
    const id = await post(account, {
      ...ask,
      summary: "Approve the revised plan for the kitchen rewiring",
      replaces: old,
    });
    expect(await list(account)).toEqual({
      version: 2,
      asks: [{ id, postedAt: first?.postedAt }],
    });
  });

  it("holds only the signed-in account's asks", async () => {
    const [owner, other] = [newAccount(), newAccount()];
    await post(owner);
    const response = await get(
      pagePaths.asks,
      await issuer.sessionToken({ claims: { sub: other } }),
    );
    expect(await response.json()).toEqual({
      version: 0,
      everAsked: false,
      hashtags: exampleHashtags,
      formerHashtags: [],
      asks: [],
    });
  });
});

async function change(
  account: string,
  path: string,
  body: unknown,
): Promise<Response> {
  return invoke(
    handler,
    new Request(`${origin}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await issuer.sessionToken({ claims: { sub: account } })}`,
        "content-type": "application/json",
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

async function openedOf(account: string) {
  const response = await get(
    pagePaths.asks,
    await issuer.sessionToken({ claims: { sub: account } }),
  );
  return z
    .object({
      version: z.number(),
      asks: z.array(z.object({ id: z.string(), opened: z.boolean() })),
    })
    .parse(await response.json());
}

describe("opening an ask from the page", () => {
  it("marks the ask as opened, keeps it in the list, and raises the version", async () => {
    const account = newAccount();
    const id = await post(account);
    const response = await change(account, askChangePaths.opened, { id });
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await openedOf(account)).toEqual({
      version: 2,
      asks: [{ id, opened: true }],
    });
  });

  it("succeeds again for an ask already opened, and changes nothing", async () => {
    const account = newAccount();
    const id = await post(account);
    await change(account, askChangePaths.opened, { id });
    const response = await change(account, askChangePaths.opened, { id });
    expect(response.status).toBe(204);
    expect((await openedOf(account)).version).toBe(2);
  });

  it("succeeds for an ask its agent has resolved, and leaves it closed", async () => {
    const account = newAccount();
    const id = await post(account);
    await call(account, "resolve", { id });
    const response = await change(account, askChangePaths.opened, { id });
    expect(response.status).toBe(204);
    expect(await openedOf(account)).toEqual({ version: 2, asks: [] });
  });
});

describe("dismissing an ask from the page", () => {
  it("drops the ask from the list, and raises the version", async () => {
    const account = newAccount();
    const id = await post(account);
    const response = await change(account, askChangePaths.dismissed, { id });
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await openedOf(account)).toEqual({ version: 2, asks: [] });
  });

  it("succeeds for an ask its agent resolved first, and changes nothing", async () => {
    const account = newAccount();
    const id = await post(account);
    await call(account, "resolve", { id });
    const response = await change(account, askChangePaths.dismissed, { id });
    expect(response.status).toBe(204);
    expect((await openedOf(account)).version).toBe(2);
  });

  it("lets the agent resolve the ask afterwards, which succeeds", async () => {
    const account = newAccount();
    const id = await post(account);
    await change(account, askChangePaths.dismissed, { id });
    expect(await call(account, "resolve", { id })).toEqual({
      id,
      status: "resolved",
    });
  });
});

describe.each(Object.entries(askChangePaths))(
  "a change to an ask, %s,",
  (_, path) => {
    it("refuses an id the account has no ask for as not_found, and changes nothing", async () => {
      const account = newAccount();
      await post(account);
      const response = await change(account, path, {
        id: "AAAAAAAAAAAAAAAAAAAAAAAA",
      });
      expect(response.status).toBe(404);
      const refusal = refusalSchema.parse(await response.json());
      expect(refusal.code).toBe("not_found");
      expect(refusal.class).toBe("do not retry");
      expect((await openedOf(account)).version).toBe(1);
    });

    it("refuses another account's ask exactly as an id that does not exist, and leaves it alone", async () => {
      const [owner, other] = [newAccount(), newAccount()];
      const id = await post(owner);
      const borrowed = await change(other, path, { id });
      const unknown = await change(other, path, {
        id: "AAAAAAAAAAAAAAAAAAAAAAAA",
      });
      expect(borrowed.status).toBe(404);
      expect(await borrowed.json()).toEqual(await unknown.json());
      expect(await openedOf(owner)).toEqual({
        version: 1,
        asks: [{ id, opened: false }],
      });
    });

    it.each([
      ["no body", ""],
      ["text that is not JSON", "opened"],
      ["no id", {}],
      ["an id that is not text", { id: 12 }],
      ["an id longer than any askme gives", { id: "A".repeat(65) }],
      ["an id with characters askme never uses", { id: "a/b" }],
      ["a field besides the id", { id: "AAAA", account: "user_other" }],
    ])("refuses %s as invalid_input", async (_, body) => {
      const account = newAccount();
      await post(account);
      const response = await change(account, path, body);
      expect(response.status).toBe(400);
      const refusal = refusalSchema.parse(await response.json());
      expect(refusal.code).toBe("invalid_input");
      expect(refusal.class).toBe("do not retry");
      expect((await openedOf(account)).version).toBe(1);
    });
  },
);

describe("a poll for the list", () => {
  it.each(["abc", "-1", "1.5", ""])(
    "refuses a version that is not a whole number, %j, as invalid_input",
    async (since) => {
      const response = await get(
        `${pagePaths.asks}?since=${since}`,
        await issuer.sessionToken({ claims: { sub: newAccount() } }),
      );
      expect(response.status).toBe(400);
      const refusal = refusalSchema.parse(await response.json());
      expect(refusal.code).toBe("invalid_input");
      expect(refusal.class).toBe("do not retry");
    },
  );
});

describe("the connection details", () => {
  it("give the MCP server's address", async () => {
    const response = await get(
      pagePaths.connection,
      await issuer.sessionToken(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mcpUrl: `${origin}/mcp` });
  });
});

describe.each(Object.values(pagePaths))("a call to %s", (path) => {
  it("is refused at the HTTP level with no token", async () => {
    const response = await get(path);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("is refused at the HTTP level with an expired session token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const response = await get(
      path,
      await issuer.sessionToken({
        claims: { iat: now - 7200, exp: now - 3600 },
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer error="invalid_token"',
    );
  });

  it("is refused at the HTTP level with a token that names no session", async () => {
    const response = await get(
      path,
      await issuer.sessionToken({ claims: { sid: undefined } }),
    );
    expect(response.status).toBe(401);
  });

  it("is refused as insufficient_scope with an agent's token", async () => {
    const response = await get(path, await issuer.token());
    expect(response.status).toBe(403);
    const refusal = refusalSchema.parse(await response.json());
    expect(refusal.code).toBe("insufficient_scope");
    expect(refusal.class).toBe("do not retry");
  });
});

const session = (account: string) =>
  issuer.sessionToken({ claims: { sub: account } });

const saveRules = async (
  account: string,
  body: unknown,
  using: LambdaHandler = handler,
) =>
  invoke(
    using,
    new Request(`${origin}${pagePaths.rules}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${await session(account)}`,
        "content-type": "application/json",
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

const rulesText = "#work is my day job.\n\n#shop is my online shop.";

const officeHours = {
  days: ["mon", "tue", "wed", "thu", "fri"],
  from: "08:00",
  to: "18:00",
};

describe("the rules", () => {
  it("are the example rules for a new account, with the hashtags read from them", async () => {
    const response = await get(pagePaths.rules, await session(newAccount()));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      text: exampleRules.text,
      hashtags: exampleHashtags,
      readFailed: false,
    });
    expect(fakes.model.calls).toEqual([]);
  });

  it("are saved, with the hashtags the model read from them, each with its colour", async () => {
    // A handler loaded afresh has not read the key, whatever ran before.
    vi.resetModules();
    const fresh = (await import("./src/handler")).handler;
    const account = newAccount();
    fakes.model.reply({ json: { hashtags: ["shop", "work"], hours: [] } });
    const response = await saveRules(account, { text: rulesText }, fresh);
    expect(response.status).toBe(200);
    const saved = {
      text: rulesText,
      hashtags: [
        { name: "work", colour: 0 },
        { name: "shop", colour: 1 },
      ],
      readFailed: false,
    };
    expect(await response.json()).toEqual(saved);
    expect(
      await (await get(pagePaths.rules, await session(account))).json(),
    ).toEqual(saved);
    expect(fakes.model.calls).toEqual([
      expect.objectContaining({ authorization: `Bearer ${testModelKey}` }),
    ]);
    expect(fakes.parameters.asked).toEqual([modelKeyParameter]);
  });

  it("are saved with the time zone sent, and each hashtag's hours, which the list carries too", async () => {
    const account = newAccount();
    fakes.model.reply({
      json: {
        hashtags: ["work", "shop"],
        hours: [{ hashtag: "work", ...officeHours }],
      },
    });
    const response = await saveRules(account, {
      text: rulesText,
      timeZone: "Europe/London",
    });
    expect(response.status).toBe(200);
    const saved = {
      text: rulesText,
      hashtags: [
        { name: "work", colour: 0, hours: [officeHours] },
        { name: "shop", colour: 1 },
      ],
      readFailed: false,
      timeZone: "Europe/London",
    };
    expect(await response.json()).toEqual(saved);
    expect(
      await (await get(pagePaths.rules, await session(account))).json(),
    ).toEqual(saved);
    expect(
      await (await get(pagePaths.asks, await session(account))).json(),
    ).toMatchObject({ hashtags: saved.hashtags, timeZone: "Europe/London" });
  });

  it("keep a time zone as it was sent, even one the service does not know", async () => {
    const account = newAccount();
    fakes.model.reply({ json: { hashtags: ["work"], hours: [] } });
    const response = await saveRules(account, {
      text: "#work",
      timeZone: "America/Not_Yet_Named",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      timeZone: "America/Not_Yet_Named",
    });
  });

  it("keep the time zone saved before when a save sends none", async () => {
    const account = newAccount();
    fakes.model.reply({ json: { hashtags: ["work"], hours: [] } });
    await saveRules(account, { text: "#work", timeZone: "Asia/Tokyo" });
    fakes.model.reply({ json: { hashtags: ["work"], hours: [] } });
    const response = await saveRules(account, { text: "#work first." });
    expect(await response.json()).toMatchObject({ timeZone: "Asia/Tokyo" });
  });

  it("keep the old hours when the model cannot read the rules, in the time zone sent", async () => {
    const account = newAccount();
    fakes.model.reply({
      json: {
        hashtags: ["work"],
        hours: [{ hashtag: "work", ...officeHours }],
      },
    });
    await saveRules(account, {
      text: "#work first.",
      timeZone: "Europe/London",
    });
    const capture = captureLogs();
    fakes.model.reply({ status: 502 });
    const response = await saveRules(account, {
      text: rulesText,
      timeZone: "America/New_York",
    });
    capture.restore();
    expect(await response.json()).toEqual({
      text: rulesText,
      hashtags: [{ name: "work", colour: 0, hours: [officeHours] }],
      readFailed: true,
      timeZone: "America/New_York",
    });
  });

  it("keep the text and the old hashtags when the model cannot read them, and say so", async () => {
    const account = newAccount();
    fakes.model.reply({ json: { hashtags: ["work"], hours: [] } });
    await saveRules(account, { text: "#work first." });
    const capture = captureLogs();
    fakes.model.reply({ status: 502 });
    const response = await saveRules(account, { text: rulesText });
    capture.restore();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      text: rulesText,
      hashtags: [{ name: "work", colour: 0 }],
      readFailed: true,
    });
    expect(
      capture.lines.some(
        (line) =>
          line.method === "warn" &&
          lineText(line).includes("rules-read-failed"),
      ),
    ).toBe(true);
  });

  it.each([
    [401, "error"],
    [402, "error"],
    [403, "warn"],
    [429, "warn"],
    [500, "warn"],
    [503, "warn"],
  ])(
    "log a %i from the model at %s, and keep the text",
    async (status, level) => {
      const account = newAccount();
      const capture = captureLogs();
      fakes.model.reply({ status });
      const response = await saveRules(account, { text: rulesText });
      capture.restore();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(
        expect.objectContaining({ text: rulesText, readFailed: true }),
      );
      // The failed reading stays at warn. askme's own fault adds an error.
      const failed = capture.lines.filter((line) =>
        lineText(line).includes("rules-read-failed"),
      );
      expect(failed.map(({ method }) => method)).toEqual(["warn"]);
      const errors = capture.lines.filter(({ method }) => method === "error");
      expect(errors.map(lineText)).toEqual(
        level === "error"
          ? [
              expect.stringMatching(
                new RegExp(`request-failed.*status-${String(status)}`, "u"),
              ),
            ]
          : [],
      );
    },
  );

  it("keep the old hashtags when the model names one the rules do not write", async () => {
    const account = newAccount();
    fakes.model.reply({ json: { hashtags: ["home"], hours: [] } });
    const response = await saveRules(account, { text: rulesText });
    expect(await response.json()).toEqual({
      text: rulesText,
      hashtags: exampleHashtags,
      readFailed: true,
    });
  });

  it("with the box empty, have no hashtags, and ask the model nothing", async () => {
    const account = newAccount();
    fakes.model.reply({ json: { hashtags: ["work"], hours: [] } });
    await saveRules(account, { text: "#work" });
    const calls = fakes.model.calls.length;
    const response = await saveRules(account, { text: "" });
    expect(await response.json()).toEqual({
      text: "",
      hashtags: [],
      readFailed: false,
    });
    expect(fakes.model.calls).toHaveLength(calls);
  });

  it("keep each hashtag's colour when the rules change", async () => {
    const account = newAccount();
    fakes.model.reply({ json: { hashtags: ["work", "shop"], hours: [] } });
    await saveRules(account, { text: rulesText });
    fakes.model.reply({ json: { hashtags: ["shop", "family"], hours: [] } });
    const response = await saveRules(account, {
      text: "#shop first, then #family.",
    });
    expect(await response.json()).toMatchObject({
      hashtags: [
        { name: "shop", colour: 1 },
        { name: "family", colour: 2 },
      ],
    });
  });

  it.each([
    ["rules over the limit", { text: "x".repeat(rulesLimit + 1) }],
    ["a body that is not JSON", "#work is my day job."],
    ["a body with another field", { text: "#work", hours: "9 to 5" }],
    [
      "a time zone that is not a zone's name",
      { text: "#work", timeZone: "not a zone" },
    ],
    [
      "a time zone's name over the limit",
      { text: "#work", timeZone: `Europe/${"x".repeat(timeZoneLimit)}` },
    ],
    ["no body", undefined],
  ])("refuse %s as invalid_input, and store nothing", async (_, body) => {
    const account = newAccount();
    const response = await saveRules(account, body);
    expect(response.status).toBe(400);
    const refusal = refusalSchema.parse(await response.json());
    expect(refusal.code).toBe("invalid_input");
    expect(refusal.class).toBe("do not retry");
    expect(refusal.message).toContain(String(rulesLimit));
    expect(refusal.message).toContain('"timeZone"');
    expect(
      await storedItems(
        inject("databaseEndpoint"),
        inject("tableName"),
        account,
      ),
    ).toEqual([]);
  });

  it(`are saved at most ${String(rateLimits.rulesSave.limit)} times a minute for each account, then refused with rate_limited`, async () => {
    // Every save falls in one window, so the last one is over the limit.
    stopClockAt(noon);
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const account = newAccount();
    for (let n = 0; n < rateLimits.rulesSave.limit; n += 1) {
      expect((await saveRules(account, { text: "" })).status).toBe(200);
    }
    const response = await saveRules(account, { text: "" });
    expect(response.status).toBe(429);
    const refusal = refusalSchema.parse(await response.json());
    expect(refusal.code).toBe("rate_limited");
    expect(refusal.class).toBe("retry");
    expect(refusal.message).toContain(String(rateLimits.rulesSave.limit));
    expect(refusal.message).toContain("Wait 30 seconds, then save again.");
    expect((await saveRules(newAccount(), { text: "" })).status).toBe(200);
  });
});

async function sorted(account: string) {
  const response = await get(pagePaths.asks, await session(account));
  const hashtags = z.array(z.object({ name: z.string(), colour: z.number() }));
  return z
    .object({
      hashtags,
      formerHashtags: hashtags,
      asks: z.array(
        z.object({
          id: z.string(),
          sort: z
            .object({ hashtags: z.array(z.string()), level: z.string() })
            .nullable(),
        }),
      ),
    })
    .parse(await response.json());
}

const ownerOf = (account: string) =>
  callerOf({
    token: "test",
    clientId: "test",
    scopes: [],
    extra: { accountId: account, requestId: "r" },
  }).accountId;

// For writing past the service.
const store = createStore({
  tableName: inject("tableName"),
  endpoint: inject("databaseEndpoint"),
});
afterAll(() => {
  store.close();
});

// Straight to the store, so no job is queued, as when an ask's sorting
// stopped long ago.
async function postEarlier(
  account: string,
  newAsk: NewAsk,
  at: Date,
): Promise<string> {
  const posting = await store.postAsk(ownerOf(account), newAsk, at);
  if (posting.kind !== "posted") throw new Error("Not posted.");
  return posting.id;
}

const sortOf = (account: string, askId: string) => ({
  groupId: askId,
  body: { accountId: account, askId },
  taken: true,
});

const sentSince = (from: number) =>
  fakes.queue.sent
    .slice(from)
    .map(({ groupId, body, taken }) => ({ groupId, body, taken }));

describe("an ask that stops mattering", () => {
  async function lapses(account: string) {
    const response = await get(pagePaths.asks, await session(account));
    return z
      .object({
        asks: z.array(
          z.looseObject({
            id: z.string(),
            postedAt: z.string(),
            lapsesAt: z.string().optional(),
          }),
        ),
      })
      .parse(await response.json()).asks;
  }

  it("is listed with the time it lapses, counted from when it was posted", async () => {
    const account = newAccount();
    const id = await post(account, { ...ask, stale_after_minutes: 45 });
    const [listed] = await lapses(account);
    expect(listed?.id).toBe(id);
    expect(
      Date.parse(listed?.lapsesAt ?? "") - Date.parse(listed?.postedAt ?? ""),
    ).toBe(45 * 60_000);
  });

  it("is listed with no lapse time when posted without one", async () => {
    const account = newAccount();
    const id = await post(account);
    const [listed] = await lapses(account);
    expect(listed?.id).toBe(id);
    expect(listed).not.toHaveProperty("lapsesAt");
  });

  it("is sorted with no lapse time in the sorting request, as captured at the HTTP edge", async () => {
    const account = newAccount();
    fakes.model.reply({ json: { hashtags: ["work", "shop"], hours: [] } });
    await saveRules(account, { text: rulesText });
    await runSorts();
    const summary = `Stops mattering ${randomUUID()}`;
    await post(account, { ...ask, summary, stale_after_minutes: 4321 });
    fakes.model.reply({
      json: { hashtags: ["work"], level: "normal", reason: "It can wait." },
    });
    await runSorts();
    const sorting = fakes.model.calls.filter((call) =>
      JSON.stringify(call.body).includes(summary),
    );
    expect(sorting).toHaveLength(1);
    const [listed] = await lapses(account);
    const lapsesAt = Date.parse(listed?.lapsesAt ?? "");
    expect(lapsesAt).not.toBeNaN();
    const request = JSON.stringify(sorting[0]?.body);
    for (const held of [
      "stale_after_minutes",
      "staleAfterMinutes",
      "lapsesAt",
      "4321",
      new Date(lapsesAt).toISOString(),
      String(lapsesAt),
      String(lapsesAt / 1000),
    ]) {
      expect(request).not.toContain(held);
    }
  });
});

describe("sorting", () => {
  it("never holds up posting: the ask is listed as not sorted yet, then sorted", async () => {
    const account = newAccount();
    fakes.model.reply({ json: { hashtags: ["work", "shop"], hours: [] } });
    await saveRules(account, { text: rulesText });
    await runSorts();
    const calls = fakes.model.calls.length;
    const id = await post(account);
    expect(fakes.model.calls).toHaveLength(calls);
    expect(sentSince(fakes.queue.sent.length - 1)).toEqual([
      sortOf(account, id),
    ]);
    expect(await sorted(account)).toEqual({
      hashtags: [
        { name: "work", colour: 0 },
        { name: "shop", colour: 1 },
      ],
      formerHashtags: [],
      asks: [{ id, sort: null }],
    });

    fakes.model.reply({
      json: {
        hashtags: ["work"],
        level: "high",
        reason: "The electrician waits.",
      },
    });
    expect(await runSorts()).toBe(1);
    expect((await sorted(account)).asks).toEqual([
      { id, sort: { hashtags: ["work"], level: "high" } },
    ]);
  });

  it("lists the reason with the sort, for the open card", async () => {
    const account = newAccount();
    fakes.model.reply({ json: { hashtags: ["work", "shop"], hours: [] } });
    await saveRules(account, { text: rulesText });
    await runSorts();
    const id = await post(account);
    fakes.model.reply({
      json: {
        hashtags: ["work"],
        level: "high",
        reason: "The electrician waits.",
      },
    });
    await runSorts();
    const response = await get(pagePaths.asks, await session(account));
    const { asks } = z
      .object({
        asks: z.array(
          z.object({
            id: z.string(),
            sort: z.object({ reason: z.string() }).nullable(),
          }),
        ),
      })
      .parse(await response.json());
    expect(asks).toEqual([{ id, sort: { reason: "The electrician waits." } }]);
  });

  it("lists every ask with no hashtag while the box is empty, asking no model", async () => {
    const account = newAccount();
    await saveRules(account, { text: "" });
    const id = await post(account);
    await runSorts();
    expect(fakes.model.calls).toEqual([]);
    expect(await sorted(account)).toEqual({
      hashtags: [],
      formerHashtags: [],
      asks: [{ id, sort: { hashtags: [], level: "normal" } }],
    });
  });

  it("posts the ask when the queue cannot take its sort, and it waits unsorted", async () => {
    const account = newAccount();
    fakes.queue.failing = true;
    const id = await post(account);
    expect((await sorted(account)).asks).toEqual([{ id, sort: null }]);
  });

  it("posts the ask when the queue answers but takes none of it, and it waits unsorted", async () => {
    const account = newAccount();
    const capture = captureLogs();
    fakes.queue.refusing = true;
    let id: string;
    try {
      id = await post(account);
    } finally {
      fakes.queue.refusing = false;
      capture.restore();
    }
    expect((await sorted(account)).asks).toEqual([{ id, sort: null }]);
    expect(
      capture.lines.some(
        (line) =>
          line.method === "warn" &&
          lineText(line).includes("sort-request-failed") &&
          lineText(line).includes(id),
      ),
    ).toBe(true);
  });

  it(`posts the ask, waiting at most ${String(sortRequestTimeoutMs)}ms on a queue that does not answer, and it waits unsorted`, async () => {
    const account = newAccount();
    fakes.queue.hanging = true;
    const started = Date.now();
    const id = await post(account);
    // The rest of the post, on loopback, takes well under a second.
    expect(Date.now() - started).toBeLessThan(sortRequestTimeoutMs + 1000);
    expect((await sorted(account)).asks).toEqual([{ id, sort: null }]);
  });

  it("leaves the ask unsorted when the model fails, and the queue delivers it again, with no poll", async () => {
    const account = newAccount();
    fakes.model.reply({ json: { hashtags: ["work", "shop"], hours: [] } });
    await saveRules(account, { text: rulesText });
    const id = await post(account);
    const deliver = () =>
      fakes.queue.deliver((event) => sorter(event, { awsRequestId: "sort-1" }));
    fakes.model.reply({ status: 503 }, { status: 503 });
    expect(await deliver()).toBe(1);
    fakes.model.reply({
      json: { hashtags: ["shop"], level: "low", reason: "Routine." },
    });
    expect(await deliver()).toBe(1);
    expect((await sorted(account)).asks).toEqual([
      { id, sort: { hashtags: ["shop"], level: "low" } },
    ]);
  });

  it("lists an ask not sorted yet with the time it turns stopped, half an hour after it was stored, and a poll queues nothing for it", async () => {
    const account = newAccount();
    const storedAt = new Date(Date.now() - 2 * 60_000);
    const id = await postEarlier(
      account,
      { summary: "Old", area: "Shop", spokenDetail: "Old." },
      storedAt,
    );
    const from = fakes.queue.sent.length;
    const response = await get(pagePaths.asks, await session(account));
    const { asks } = z
      .object({
        asks: z.array(z.object({ id: z.string(), sortingUntil: z.string() })),
      })
      .parse(await response.json());
    expect(asks).toEqual([
      {
        id,
        sortingUntil: new Date(storedAt.getTime() + sortingMs).toISOString(),
      },
    ]);
    expect(fakes.queue.sent.slice(from)).toEqual([]);
  });

  // A replacing ask keeps the old ask's postedAt, but is queued and judged
  // from when it was stored.
  it("queues a replacing ask's sort as it is posted, and only then", async () => {
    const account = newAccount();
    const old = await postEarlier(
      account,
      { summary: "Old", area: "Shop", spokenDetail: "Old." },
      new Date(Date.now() - 40 * 60_000),
    );
    const from = fakes.queue.sent.length;
    const id = await post(account, { ...ask, replaces: old });
    expect((await sorted(account)).asks).toEqual([{ id, sort: null }]);
    expect(sentSince(from)).toEqual([sortOf(account, id)]);
    await runSorts();
  });
});

async function sortedEarlier(account: string, at: Date): Promise<string> {
  const owner = ownerOf(account);
  const { version } = await store.saveRules(
    owner,
    { text: "#work first.", hashtags: ["work"] },
    at,
  );
  const id = await postEarlier(
    account,
    { summary: "Old", area: "Work", spokenDetail: "Old." },
    at,
  );
  await store.recordSort(
    owner,
    id,
    {
      hashtags: ["work"],
      level: "normal",
      reason: "Routine.",
      rulesVersion: version,
    },
    at,
  );
  return id;
}

describe("saving the rules again", () => {
  it("queues every open ask's sort, sorted or not", async () => {
    const account = newAccount();
    fakes.model.reply({ json: { hashtags: ["work", "shop"], hours: [] } });
    await saveRules(account, { text: rulesText });
    const sortedAsk = await post(account);
    // The model has no reply for the second ask, so it stays unsorted.
    fakes.model.reply({
      json: { hashtags: ["work"], level: "high", reason: "It waits." },
    });
    const unsorted = await post(account, { ...ask, summary: "Renew it" });
    await runSorts();
    expect((await sorted(account)).asks).toContainEqual({
      id: unsorted,
      sort: null,
    });

    const from = fakes.queue.sent.length;
    fakes.model.reply({ json: { hashtags: ["shop", "family"], hours: [] } });
    const response = await saveRules(account, {
      text: "#shop first, then #family.",
    });
    expect(response.status).toBe(200);
    const handedOn = sentSince(from);
    expect(handedOn).toHaveLength(2);
    expect(handedOn).toEqual(
      expect.arrayContaining([
        sortOf(account, sortedAsk),
        sortOf(account, unsorted),
      ]),
    );
    fakes.model.reply(
      { json: { hashtags: ["shop"], level: "low", reason: "Routine." } },
      { json: { hashtags: ["shop"], level: "low", reason: "Routine." } },
    );
    await runSorts();
  });

  it("keeps each ask's old hashtags, in their colours, until it is sorted again", async () => {
    const account = newAccount();
    fakes.model.reply({ json: { hashtags: ["work", "shop"], hours: [] } });
    await saveRules(account, { text: rulesText });
    fakes.model.reply({
      json: { hashtags: ["work", "shop"], level: "high", reason: "It waits." },
    });
    const id = await post(account);
    await runSorts();

    fakes.model.reply({ json: { hashtags: ["shop", "family"], hours: [] } });
    await saveRules(account, { text: "#shop first, then #family." });
    expect(await sorted(account)).toEqual({
      hashtags: [
        { name: "shop", colour: 1 },
        { name: "family", colour: 2 },
      ],
      formerHashtags: [{ name: "work", colour: 0 }],
      asks: [{ id, sort: { hashtags: ["work", "shop"], level: "high" } }],
    });

    fakes.model.reply({
      json: { hashtags: ["family"], level: "low", reason: "It can wait." },
    });
    expect(await runSorts()).toBe(1);
    expect(await sorted(account)).toEqual({
      hashtags: [
        { name: "shop", colour: 1 },
        { name: "family", colour: 2 },
      ],
      formerHashtags: [],
      asks: [{ id, sort: { hashtags: ["family"], level: "low" } }],
    });
  });

  it("takes every hashtag off the asks when the box is emptied, asking no model", async () => {
    const account = newAccount();
    fakes.model.reply({ json: { hashtags: ["work", "shop"], hours: [] } });
    await saveRules(account, { text: rulesText });
    fakes.model.reply({
      json: { hashtags: ["work"], level: "high", reason: "It waits." },
    });
    const id = await post(account);
    await runSorts();

    await saveRules(account, { text: "" });
    const calls = fakes.model.calls.length;
    expect(await runSorts()).toBe(1);
    expect(fakes.model.calls).toHaveLength(calls);
    expect(await sorted(account)).toEqual({
      hashtags: [],
      formerHashtags: [],
      asks: [{ id, sort: { hashtags: [], level: "normal" } }],
    });
  });

  it("saves the rules when the queue cannot take the asks, and each keeps its old sort", async () => {
    const account = newAccount();
    fakes.model.reply({ json: { hashtags: ["work", "shop"], hours: [] } });
    await saveRules(account, { text: rulesText });
    fakes.model.reply({
      json: { hashtags: ["work"], level: "high", reason: "It waits." },
    });
    const id = await post(account);
    await runSorts();

    const capture = captureLogs();
    fakes.queue.failing = true;
    let response: Response;
    try {
      fakes.model.reply({ json: { hashtags: ["shop"], hours: [] } });
      response = await saveRules(account, { text: "#shop only." });
    } finally {
      fakes.queue.failing = false;
      capture.restore();
    }
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      text: "#shop only.",
      hashtags: [{ name: "shop", colour: 1 }],
      readFailed: false,
    });
    expect((await sorted(account)).asks).toEqual([
      { id, sort: { hashtags: ["work"], level: "high" } },
    ]);
    expect(
      capture.lines.some(
        (line) =>
          line.method === "warn" &&
          lineText(line).includes("sort-request-failed"),
      ),
    ).toBe(true);
  });

  it("lists an ask still sorted with older rules with the time it turns stopped, half an hour after the save, and a poll queues nothing for it", async () => {
    const account = newAccount();
    const id = await sortedEarlier(account, new Date(Date.now() - 50 * 60_000));
    // Rules saved ten minutes ago, whose sort of the ask has not landed.
    const savedAt = new Date(Date.now() - 10 * 60_000);
    await store.saveRules(
      ownerOf(account),
      { text: "#shop only.", hashtags: ["shop"] },
      savedAt,
    );
    const from = fakes.queue.sent.length;
    const response = await get(pagePaths.asks, await session(account));
    const { asks } = z
      .object({
        asks: z.array(
          z.object({
            id: z.string(),
            sortingUntil: z.string(),
            sort: z.object({ hashtags: z.array(z.string()) }),
          }),
        ),
      })
      .parse(await response.json());
    expect(asks).toEqual([
      {
        id,
        sortingUntil: new Date(savedAt.getTime() + sortingMs).toISOString(),
        sort: { hashtags: ["work"] },
      },
    ]);
    expect(fakes.queue.sent.slice(from)).toEqual([]);
  });

  it("sorts again, when saved unchanged, only the asks behind the rules", async () => {
    const account = newAccount();
    fakes.model.reply({ json: { hashtags: ["work", "shop"], hours: [] } });
    await saveRules(account, { text: rulesText });
    fakes.model.reply({
      json: { hashtags: ["work"], level: "high", reason: "It waits." },
    });
    const current = await post(account);
    await runSorts();
    // An ask no job was queued for, so it is behind the rules.
    const behind = await postEarlier(
      account,
      { summary: "Behind", area: "Shop", spokenDetail: "Behind." },
      new Date(Date.now() - 40 * 60_000),
    );
    const calls = fakes.model.calls.length;
    const from = fakes.queue.sent.length;
    const response = await saveRules(account, { text: rulesText });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      text: rulesText,
      hashtags: [
        { name: "work", colour: 0 },
        { name: "shop", colour: 1 },
      ],
      readFailed: false,
    });
    expect(fakes.model.calls).toHaveLength(calls);
    expect(sentSince(from)).toEqual([sortOf(account, behind)]);
    fakes.model.reply({
      json: { hashtags: ["shop"], level: "low", reason: "Routine." },
    });
    expect(await runSorts()).toBe(1);
    expect((await sorted(account)).asks).toEqual(
      expect.arrayContaining([
        { id: current, sort: { hashtags: ["work"], level: "high" } },
        { id: behind, sort: { hashtags: ["shop"], level: "low" } },
      ]),
    );
  });
});

const sendSamples = async (account: string) =>
  invoke(
    handler,
    new Request(`${origin}${samplesPath}`, {
      method: "POST",
      headers: { authorization: `Bearer ${await session(account)}` },
    }),
  );

const sampleArea = new Map(
  sampleAreas.flatMap(({ area, asks }) =>
    asks.map(({ summary }) => [summary, area] as const),
  ),
);

async function summaries(account: string): Promise<string[]> {
  const response = await get(pagePaths.asks, await session(account));
  return z
    .object({ asks: z.array(z.object({ summary: z.string() })) })
    .parse(await response.json())
    .asks.map(({ summary }) => summary);
}

describe("sample asks", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("are posted one from each of three areas, with no agent connected, and each one's sort is queued", async () => {
    const account = newAccount();
    const from = fakes.queue.sent.length;
    const response = await sendSamples(account);
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const listed = await summaries(account);
    expect(listed).toHaveLength(3);
    expect(new Set(listed.map((summary) => sampleArea.get(summary)))).toEqual(
      new Set(sampleAreas.map(({ area }) => area)),
    );
    const { asks } = await list(account);
    expect(sentSince(from)).toEqual(
      expect.arrayContaining(asks.map(({ id }) => sortOf(account, id))),
    );
    expect(sentSince(from)).toHaveLength(3);
    // The sorts run here, so no other test's reply goes to them.
    await runSorts();
  });

  it("are sorted with the example rules a new account starts with", async () => {
    const account = newAccount();
    await runSorts();
    await sendSamples(account);
    const reply = {
      json: { hashtags: ["shop"], level: "high", reason: "A customer waits." },
    };
    fakes.model.reply(reply, reply, reply);
    expect(await runSorts()).toBe(3);
    const prompts = fakes.model.calls.map(({ body }) => JSON.stringify(body));
    expect(prompts).toHaveLength(3);
    for (const prompt of prompts) {
      expect(prompt).toContain("#work is my day job.");
    }
    expect((await sorted(account)).asks.map(({ sort }) => sort)).toEqual([
      { hashtags: ["shop"], level: "high" },
      { hashtags: ["shop"], level: "high" },
      { hashtags: ["shop"], level: "high" },
    ]);
  });

  it("are different on each press, so none is matched to one sent before, until every sample has been sent", async () => {
    const account = newAccount();
    const presses = Math.min(...sampleAreas.map(({ asks }) => asks.length));
    for (let press = 1; press <= presses; press += 1) {
      expect((await sendSamples(account)).status).toBe(204);
      const listed = await summaries(account);
      expect(listed).toHaveLength(3 * press);
      expect(new Set(listed).size).toBe(listed.length);
    }
    const response = await sendSamples(account);
    expect(response.status).toBe(429);
    const refusal = refusalSchema.parse(await response.json());
    expect(refusal.code).toBe("rate_limited");
    expect(refusal.class).toBe("retry");
    expect(refusal.message).toContain(
      `in the last ${String(dedupeWindowMinutes)} minutes`,
    );
    expect(await summaries(account)).toHaveLength(3 * presses);
    await runSorts();
  });

  it(`are refused at the rate limit with rate_limited, which says how long to wait`, async () => {
    const account = newAccount();
    for (let n = 1; n <= rateLimits.ask.limit; n += 1) {
      await store.countCall(ownerOf(account), "ask", noon);
    }
    stopClockAt(noon);
    const response = await sendSamples(account);
    expect(response.status).toBe(429);
    const refusal = refusalSchema.parse(await response.json());
    expect(refusal.code).toBe("rate_limited");
    expect(refusal.class).toBe("retry");
    expect(refusal.message).toContain(
      `${String(rateLimits.ask.limit)} asks a minute`,
    );
    expect(refusal.message).toMatch(
      /Wait 30 seconds, then send sample asks again\./u,
    );
    expect(await summaries(account)).toEqual([]);
  });

  it("are refused at the daily cap with cap_reached, which says when the cap resets", async () => {
    const account = newAccount();
    // The day's asks, one a minute through the morning, so no minute is
    // over its rate.
    for (let n = 1; n <= dailyAskCap; n += 1) {
      await store.postAsk(
        ownerOf(account),
        {
          summary: `Ask ${String(n)}`,
          area: "Home",
          spokenDetail: "Yes or no.",
        },
        new Date(noon.getTime() - n * 60_000),
      );
    }
    stopClockAt(noon);
    const response = await sendSamples(account);
    expect(response.status).toBe(429);
    const refusal = refusalSchema.parse(await response.json());
    expect(refusal.code).toBe("cap_reached");
    expect(refusal.class).toBe("do not retry");
    expect(refusal.message).toContain(`${String(dailyAskCap)} asks today`);
    expect(refusal.message).toContain("2026-10-12T00:00:00.000Z");
    vi.useRealTimers();
    expect(
      (await summaries(account)).filter((summary) => sampleArea.has(summary)),
    ).toEqual([]);
  });
});

describe("the list while the cap on model calls is spent", () => {
  const capResetsAt = async (account: string) =>
    z
      .object({ modelCapResetsAt: z.string().optional() })
      .parse(await (await get(pagePaths.asks, await session(account))).json())
      .modelCapResetsAt;

  it("carries when the cap resets while that time is ahead, and drops it once it has passed", async () => {
    const ahead = newAccount();
    const resets = new Date(Date.now() + 60 * 60_000);
    await store.recordModelCapReset(ownerOf(ahead), resets);
    expect(await capResetsAt(ahead)).toBe(resets.toISOString());
    const passed = newAccount();
    await store.recordModelCapReset(
      ownerOf(passed),
      new Date(Date.now() - 60_000),
    );
    expect(await capResetsAt(passed)).toBeUndefined();
  });

  it("carries nothing for an account the cap never refused", async () => {
    expect(await capResetsAt(newAccount())).toBeUndefined();
  });
});
