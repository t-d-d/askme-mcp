import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handler, routes } from "../service/src/handler";
import { asksAnswer, pagePaths } from "../shared/page-api";
import { startFakeIssuer, type FakeIssuer } from "../test/identity";
import { invoke } from "../test/lambda";
import { connect, mcpUrl, metadataUrl, origin, refusalOf } from "../test/mcp";

const ask = {
  summary: "Approve the plan for the kitchen rewiring",
  area: "Home renovation",
  spoken_detail: "The electrician needs a yes or no before Friday.",
};

let issuer: FakeIssuer;
let otherIssuer: FakeIssuer;
beforeAll(async () => {
  issuer = await startFakeIssuer();
  otherIssuer = await startFakeIssuer();
  vi.stubEnv("CLERK_ISSUER", issuer.issuer);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await issuer.close();
  await otherIssuer.close();
});

const checked = Object.entries(routes)
  .filter(([, access]) => access !== "public")
  .map(([route]) => route);

// The routes an agent calls, whose 401 starts its sign-in.
const agentRoutes = Object.entries(routes)
  .filter(([, access]) => access === "agent")
  .map(([route]) => route);

function call(route: string, token?: string): Promise<Response> {
  const [method = "", path = ""] = route.split(" ");
  return invoke(
    handler,
    new Request(`${origin}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      ...(method === "POST" ? { body: "{}" } : {}),
    }),
  );
}

describe("fitness: every route checks a token (identity.md)", () => {
  it("finds the routes", () => {
    expect(checked).toEqual(
      expect.arrayContaining([
        "POST /mcp",
        "GET /mcp",
        "DELETE /mcp",
        "GET /api/asks",
        "GET /api/connection",
      ]),
    );
  });

  it.each(checked)("refuses %s with no token", async (route) => {
    const response = await call(route);
    expect(response.status).toBe(401);
  });

  it.each(checked)(
    "refuses %s with a token another Clerk instance issued",
    async (route) => {
      for (const token of [
        await otherIssuer.token(),
        await otherIssuer.sessionToken(),
      ]) {
        const response = await call(route, token);
        expect(response.status).toBe(401);
      }
    },
  );

  it.each(checked)(
    "refuses %s with a token signed by a key the issuer does not publish",
    async (route) => {
      const response = await call(
        route,
        await issuer.token({ foreignKey: true }),
      );
      expect(response.status).toBe(401);
    },
  );

  // Signed with the issuer's own key, so only the iss claim is wrong.
  it.each(checked)(
    "refuses %s with a token that names another issuer",
    async (route) => {
      const response = await call(
        route,
        await issuer.token({ claims: { iss: otherIssuer.issuer } }),
      );
      expect(response.status).toBe(401);
    },
  );

  it("refuses the ask tool through the client with no token", async () => {
    await expect(connect(handler)).rejects.toThrow();
  });

  it("lets a verified token through to the MCP server", async () => {
    const client = await connect(handler, { token: await issuer.token() });
    expect((await client.listTools()).tools).not.toEqual([]);
    await client.close();
  });
});

describe("fitness: the metadata is served (identity.md)", () => {
  it.each(agentRoutes)(
    "points the 401 from %s to the metadata",
    async (route) => {
      const response = await call(route);
      expect(response.headers.get("www-authenticate")).toMatch(
        new RegExp(
          `^Bearer error="invalid_token".*, scope="asks:create", resource_metadata="${metadataUrl}"$`,
          "u",
        ),
      );
    },
  );

  it("serves the metadata with no token, naming the authorisation server", async () => {
    const response = await invoke(handler, new Request(metadataUrl));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/u);
    const metadata: unknown = await response.json();
    expect(metadata).toMatchObject({
      resource: mcpUrl,
      authorization_servers: [issuer.issuer],
    });
  });
});

describe("fitness: the account comes from the token (identity.md)", () => {
  const sub = () => `user_${randomUUID().slice(0, 8)}`;

  it("lists the caller's own asks, whatever account the request names", async () => {
    const [owner, caller] = [sub(), sub()];
    const agent = await connect(handler, {
      token: await issuer.token({ claims: { sub: owner } }),
    });
    await agent.callTool({ name: "ask", arguments: ask });
    await agent.close();

    const response = await invoke(
      handler,
      new Request(`${origin}${pagePaths.asks}?account=${owner}&sub=${owner}`, {
        headers: {
          authorization: `Bearer ${await issuer.sessionToken({ claims: { sub: caller } })}`,
          "x-account-id": owner,
          "x-user-id": owner,
        },
      }),
    );
    expect(asksAnswer.parse(await response.json()).asks).toEqual([]);
  });

  it("refuses an ask that names an account, and stores nothing for it", async () => {
    const [owner, caller] = [sub(), sub()];
    const agent = await connect(handler, {
      token: await issuer.token({ claims: { sub: caller } }),
    });
    const refusal = refusalOf(
      await agent.callTool({
        name: "ask",
        arguments: { ...ask, account: owner },
      }),
    );
    expect(refusal.code).toBe("invalid_input");
    await agent.close();

    const response = await invoke(
      handler,
      new Request(`${origin}${pagePaths.asks}`, {
        headers: {
          authorization: `Bearer ${await issuer.sessionToken({ claims: { sub: owner } })}`,
        },
      }),
    );
    expect(asksAnswer.parse(await response.json()).everAsked).toBe(false);
  });
});
