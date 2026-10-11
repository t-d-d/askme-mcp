// The page's API end to end, in process: API Gateway's event, the session
// token check, and the store on the local DynamoDB.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { pagePaths } from "../shared/page-api";
import { startFakeIssuer, type FakeIssuer } from "../test/identity";
import { invoke } from "../test/lambda";
import { connect, origin } from "../test/mcp";
import { handler } from "./src/handler";

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

async function post(account: string): Promise<string> {
  const client = await connect(handler, {
    token: await issuer.token({ claims: { sub: account } }),
  });
  try {
    const result = await client.callTool({ name: "ask", arguments: ask });
    return z.object({ id: z.string() }).parse(result.structuredContent).id;
  } finally {
    await client.close();
  }
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
    });
    const postedAt = Date.parse(posted);
    expect(postedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(postedAt).toBeLessThanOrEqual(Date.now());
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
