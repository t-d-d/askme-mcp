import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handler, routes } from "../service/src/handler";
import { startFakeIssuer, type FakeIssuer } from "../test/identity";
import { invoke } from "../test/lambda";
import { connect, mcpUrl, metadataUrl, origin } from "../test/mcp";

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

// Every route but the metadata, as "METHOD /path".
const checked = Object.entries(routes)
  .filter(([, access]) => access === "token")
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
      expect.arrayContaining(["POST /mcp", "GET /mcp", "DELETE /mcp"]),
    );
  });

  it.each(checked)("refuses %s with no token", async (route) => {
    const response = await call(route);
    expect(response.status).toBe(401);
  });

  it.each(checked)(
    "refuses %s with a token another Clerk instance issued",
    async (route) => {
      const response = await call(route, await otherIssuer.token());
      expect(response.status).toBe(401);
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
  it.each(checked)("points the 401 from %s to the metadata", async (route) => {
    const response = await call(route);
    expect(response.headers.get("www-authenticate")).toMatch(
      new RegExp(
        `^Bearer error="invalid_token".*, scope="asks:create", resource_metadata="${metadataUrl}"$`,
        "u",
      ),
    );
  });

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
