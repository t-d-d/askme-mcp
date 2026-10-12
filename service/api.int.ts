// The page's API end to end, in process: API Gateway's event, the session
// token check, and the store on the local DynamoDB.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { z } from "zod";
import { pagePaths, rulesLimit } from "../shared/page-api";
import { storedItems, storeItem } from "../test/dynamodb";
import { fakes, testModelKey } from "../test/fakes";
import { startFakeIssuer, type FakeIssuer } from "../test/identity";
import { invoke } from "../test/lambda";
import { captureLogs, lineText } from "../test/logs";
import { connect, origin } from "../test/mcp";
import { sortRetryAfterMs } from "./src/api";
import { handler } from "./src/handler";
import { callerOf } from "./src/identity";
import { sortRequestTimeoutMs } from "./src/jobs";
import { rulesSaveLimit } from "./src/rate";
import { handler as sorter } from "./src/sorter";
import { keys } from "./src/store/keys";
import { askLifetimeDays, createStore, type NewAsk } from "./src/store/store";

let issuer: FakeIssuer;
beforeAll(async () => {
  issuer = await startFakeIssuer();
  vi.stubEnv("CLERK_ISSUER", issuer.issuer);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await issuer.close();
});

// A fresh account for each test: the table is shared by every test file.
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

// One tool call, as an agent of the account.
async function call(
  account: string,
  name: string,
  args: Record<string, string>,
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
  args: Record<string, string> = ask,
): Promise<string> {
  return z.object({ id: z.string() }).parse(await call(account, "ask", args))
    .id;
}

// The list as the page reads it: the version, and each ask's id and when
// it was posted.
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

describe("the list of open asks", () => {
  it("is empty for a new account, which has never had an ask", async () => {
    const response = await get(
      pagePaths.asks,
      await issuer.sessionToken({ claims: { sub: newAccount() } }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      version: 0,
      everAsked: false,
      hashtags: [],
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
        asks: z.array(z.looseObject({ postedAt: z.string() })),
      })
      .parse(await response.json());
    expect(answer.version).toBe(1);
    expect(answer.everAsked).toBe(true);
    const [listed] = answer.asks;
    const { postedAt: posted, ...rest } = listed ?? { postedAt: "" };
    expect(answer.asks).toHaveLength(1);
    expect(rest).toEqual({
      id,
      summary: ask.summary,
      spokenDetail: ask.spoken_detail,
      sort: null,
    });
    const postedAt = Date.parse(posted);
    expect(postedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(postedAt).toBeLessThanOrEqual(Date.now());
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
      hashtags: [],
      asks: [],
    });
  });
});

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

// Saves the rules as the page does.
const saveRules = async (account: string, body: unknown) =>
  invoke(
    handler,
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

describe("the rules", () => {
  it("are empty for a new account, with no hashtags", async () => {
    const response = await get(pagePaths.rules, await session(newAccount()));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      text: "",
      hashtags: [],
      readFailed: false,
    });
  });

  it("are saved, with the hashtags the model read from them, each with its colour", async () => {
    const account = newAccount();
    const calls = fakes.model.calls.length;
    fakes.model.reply({ json: { hashtags: ["shop", "work"] } });
    const response = await saveRules(account, { text: rulesText });
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
    // One call, with the service's own key from Parameter Store.
    expect(fakes.model.calls.slice(calls)).toEqual([
      expect.objectContaining({ authorization: `Bearer ${testModelKey}` }),
    ]);
    expect(fakes.parameters.asked).toContain("/askme/openrouter/api-key");
  });

  it("keep the text and the old hashtags when the model cannot read them, and say so", async () => {
    const account = newAccount();
    fakes.model.reply({ json: { hashtags: ["work"] } });
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

  it("keep the old hashtags when the model names one the rules do not write", async () => {
    const account = newAccount();
    fakes.model.reply({ json: { hashtags: ["home"] } });
    const response = await saveRules(account, { text: rulesText });
    expect(await response.json()).toEqual({
      text: rulesText,
      hashtags: [],
      readFailed: true,
    });
  });

  it("with the box empty, have no hashtags, and ask the model nothing", async () => {
    const account = newAccount();
    fakes.model.reply({ json: { hashtags: ["work"] } });
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
    fakes.model.reply({ json: { hashtags: ["work", "shop"] } });
    await saveRules(account, { text: rulesText });
    fakes.model.reply({ json: { hashtags: ["shop", "family"] } });
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
    ["no body", undefined],
  ])("refuse %s as invalid_input, and store nothing", async (_, body) => {
    const account = newAccount();
    const response = await saveRules(account, body);
    expect(response.status).toBe(400);
    const refusal = refusalSchema.parse(await response.json());
    expect(refusal.code).toBe("invalid_input");
    expect(refusal.class).toBe("do not retry");
    expect(refusal.message).toContain(String(rulesLimit));
    expect(
      await storedItems(
        inject("databaseEndpoint"),
        inject("tableName"),
        account,
      ),
    ).toEqual([]);
  });

  it(`are saved at most ${String(rulesSaveLimit.saves)} times a minute for each account, then refused with rate_limited`, async () => {
    const account = newAccount();
    for (let n = 0; n < rulesSaveLimit.saves; n += 1) {
      expect((await saveRules(account, { text: "" })).status).toBe(200);
    }
    const response = await saveRules(account, { text: "" });
    expect(response.status).toBe(429);
    const refusal = refusalSchema.parse(await response.json());
    expect(refusal.code).toBe("rate_limited");
    expect(refusal.class).toBe("retry");
    expect(refusal.message).toContain(String(rulesSaveLimit.saves));
    expect(refusal.message).toMatch(/Wait \d+ seconds?, then save again\./u);
    // Another account is not held back by it.
    expect((await saveRules(newAccount(), { text: "" })).status).toBe(200);
  });
});

// The list with each ask's sort, as the page reads it.
async function sorted(account: string) {
  const response = await get(pagePaths.asks, await session(account));
  return z
    .object({
      hashtags: z.array(z.object({ name: z.string(), colour: z.number() })),
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

// Runs the sorts handed on so far, as Lambda would.
const runSorts = () =>
  fakes.lambda.drain((payload) => sorter(payload, { awsRequestId: "sort-1" }));

// The account's id as the token check gives it, for the store.
const ownerOf = (account: string) =>
  callerOf({
    token: "test",
    clientId: "test",
    scopes: [],
    extra: { accountId: account, requestId: "r" },
  }).accountId;

// Posts an ask straight to the store at a time in the past, so it is not
// handed to the sort function, as when its sort failed back then. Gives its
// id.
async function postEarlier(
  account: string,
  newAsk: NewAsk,
  at: Date,
): Promise<string> {
  const store = createStore({
    tableName: inject("tableName"),
    endpoint: inject("databaseEndpoint"),
  });
  try {
    const posting = await store.postAsk(ownerOf(account), newAsk, at);
    if (posting.kind !== "posted") throw new Error("Not posted.");
    return posting.id;
  } finally {
    store.close();
  }
}

// The sort function, handed one of the account's asks.
const sortOf = (account: string, askId: string) => ({
  functionName: "askme-prod-sort",
  invocationType: "Event",
  payload: { accountId: account, askId },
});

describe("sorting", () => {
  it("never holds up posting: the ask is listed as not sorted yet, then sorted", async () => {
    const account = newAccount();
    fakes.model.reply({ json: { hashtags: ["work", "shop"] } });
    await saveRules(account, { text: rulesText });
    await runSorts();
    const calls = fakes.model.calls.length;
    const id = await post(account);
    // Posting asked the model nothing: it handed the ask on.
    expect(fakes.model.calls).toHaveLength(calls);
    expect(fakes.lambda.invoked.at(-1)).toEqual({
      functionName: "askme-prod-sort",
      invocationType: "Event",
      payload: { accountId: account, askId: id },
    });
    expect(await sorted(account)).toEqual({
      hashtags: [
        { name: "work", colour: 0 },
        { name: "shop", colour: 1 },
      ],
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

  it("lists every ask with no hashtag while the box is empty, asking no model", async () => {
    const account = newAccount();
    const id = await post(account);
    const calls = fakes.model.calls.length;
    await runSorts();
    expect(fakes.model.calls).toHaveLength(calls);
    expect(await sorted(account)).toEqual({
      hashtags: [],
      asks: [{ id, sort: { hashtags: [], level: "normal" } }],
    });
  });

  it("posts the ask when Lambda cannot take it, and it waits unsorted", async () => {
    const account = newAccount();
    fakes.lambda.failing = true;
    try {
      const id = await post(account);
      expect((await sorted(account)).asks).toEqual([{ id, sort: null }]);
    } finally {
      fakes.lambda.failing = false;
    }
  });

  it(`posts the ask, waiting at most ${String(sortRequestTimeoutMs)}ms on a Lambda that does not answer, and it waits unsorted`, async () => {
    const account = newAccount();
    fakes.lambda.hanging = true;
    try {
      const started = Date.now();
      const id = await post(account);
      // The rest of the post, on loopback, takes well under a second.
      expect(Date.now() - started).toBeLessThan(sortRequestTimeoutMs + 1000);
      expect((await sorted(account)).asks).toEqual([{ id, sort: null }]);
    } finally {
      fakes.lambda.hanging = false;
    }
  });

  it("leaves the ask unsorted when the model fails, and a poll asks again after a minute", async () => {
    const account = newAccount();
    fakes.model.reply({ json: { hashtags: ["work", "shop"] } });
    await saveRules(account, { text: rulesText });
    // An ask posted two minutes ago, whose sort failed.
    const old = await postEarlier(
      account,
      { summary: "Old", area: "Shop", spokenDetail: "Old." },
      new Date(Date.now() - 2 * sortRetryAfterMs),
    );
    // A new ask, which is not yet due to be asked for again.
    const fresh = await post(account);
    await runSorts();

    const invoked = fakes.lambda.invoked.length;
    expect((await sorted(account)).asks).toContainEqual({
      id: old,
      sort: null,
    });
    expect(fakes.lambda.invoked.slice(invoked)).toEqual([sortOf(account, old)]);
    expect(fakes.lambda.invoked.slice(invoked)).not.toContainEqual(
      expect.objectContaining({
        payload: { accountId: account, askId: fresh },
      }),
    );
    fakes.model.reply({
      json: { hashtags: ["shop"], level: "low", reason: "Routine." },
    });
    await runSorts();
    expect((await sorted(account)).asks).toContainEqual({
      id: old,
      sort: { hashtags: ["shop"], level: "low" },
    });
  });

  // A replacing ask keeps the posting time of the ask it replaces (ADR 13),
  // so it looks overdue the moment it is stored.
  it("does not ask again for a replacing ask while its first sort may still be running", async () => {
    const account = newAccount();
    const old = await postEarlier(
      account,
      { summary: "Old", area: "Shop", spokenDetail: "Old." },
      new Date(Date.now() - 2 * sortRetryAfterMs),
    );
    const invoked = fakes.lambda.invoked.length;
    const id = await post(account, { ...ask, replaces: old });
    expect((await sorted(account)).asks).toEqual([{ id, sort: null }]);
    expect(fakes.lambda.invoked.slice(invoked)).toEqual([sortOf(account, id)]);
    await runSorts();
  });

  it("asks again for a replacing ask left unsorted a minute after it was stored", async () => {
    const account = newAccount();
    const old = await postEarlier(
      account,
      { summary: "Old", area: "Shop", spokenDetail: "Old." },
      new Date(Date.now() - 3 * sortRetryAfterMs),
    );
    const id = await postEarlier(
      account,
      { summary: "New", area: "Shop", spokenDetail: "New.", replaces: old },
      new Date(Date.now() - 2 * sortRetryAfterMs),
    );
    const invoked = fakes.lambda.invoked.length;
    expect((await sorted(account)).asks).toEqual([{ id, sort: null }]);
    expect(fakes.lambda.invoked.slice(invoked)).toEqual([sortOf(account, id)]);
    await runSorts();
  });

  it("asks again for an ask stored before askme recorded when, a minute after it was posted", async () => {
    const account = newAccount();
    const id = "AAAAAAAAAAAAAAAAAAAAAAAA";
    const posted = new Date(Date.now() - 2 * sortRetryAfterMs);
    await storeItem(inject("databaseEndpoint"), inject("tableName"), {
      ...keys.openAsk(ownerOf(account), id),
      id,
      summary: "Old",
      area: "Shop",
      spokenDetail: "Old.",
      postedAt: posted.toISOString(),
      expiresAt: Math.floor(posted.getTime() / 1000) + askLifetimeDays * 86_400,
    });
    const invoked = fakes.lambda.invoked.length;
    expect((await sorted(account)).asks).toEqual([{ id, sort: null }]);
    expect(fakes.lambda.invoked.slice(invoked)).toEqual([sortOf(account, id)]);
    await runSorts();
  });
});
