// The MCP endpoint end to end, in process: API Gateway's event, the token
// check, the MCP server and the ask tool, driven by the official client.
import { McpServer } from "@modelcontextprotocol/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { startFakeIssuer, type FakeIssuer } from "../test/identity";
import { invoke } from "../test/lambda";
import { captureLogs, lineText } from "../test/logs";
import { connect, eras, mcpUrl, metadataUrl, refusalOf } from "../test/mcp";
import { fixedAskId } from "./src/ask";
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

const ask = {
  summary: "Approve the plan for the kitchen rewiring",
  area: "Home renovation",
  spoken_detail:
    "The electrician needs a yes or no on the rewiring plan before Friday.",
  action_link: "https://github.com/t-d-d/askme-mcp/pull/1",
};

describe("a call with no token", () => {
  it("gets a 401 that points to the metadata", async () => {
    const seen: Response[] = [];
    await expect(connect(handler, { seen })).rejects.toThrow();
    const [first] = seen;
    expect(first?.status).toBe(401);
    expect(first?.headers.get("www-authenticate")).toMatch(
      new RegExp(`^Bearer .*resource_metadata="${metadataUrl}"`, "u"),
    );
  });
});

describe("a call with an empty authorization header", () => {
  it("is logged as a missing token, not a rejected one", async () => {
    const capture = captureLogs();
    try {
      const response = await invoke(
        handler,
        new Request(mcpUrl, { method: "POST", headers: { authorization: "" } }),
      );
      expect(response.status).toBe(401);
      const written = capture.lines.map(lineText).join("\n");
      expect(written).toContain("token-missing");
      expect(written).not.toContain("token-rejected");
    } finally {
      capture.restore();
    }
  });
});

describe("the metadata", () => {
  it("names Clerk as the authorisation server, and the one scope", async () => {
    const response = await invoke(handler, new Request(metadataUrl));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      resource: mcpUrl,
      authorization_servers: [issuer.issuer],
      scopes_supported: ["asks:create"],
      bearer_methods_supported: ["header"],
      resource_name: "askme",
    });
  });
});

describe.each(eras)(
  "a verified token with asks:create, %s handshake",
  (era) => {
    it("reaches one tool, ask", async () => {
      const client = await connect(handler, {
        token: await issuer.token(),
        era,
      });
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(["ask"]);
      await client.close();
    });

    it("gets the fixed id back from ask", async () => {
      const client = await connect(handler, {
        token: await issuer.token(),
        era,
      });
      const result = await client.callTool({ name: "ask", arguments: ask });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({
        id: fixedAskId,
        status: "posted",
      });
      await client.close();
    });

    it("has its arguments parsed by the real schema", async () => {
      const client = await connect(handler, {
        token: await issuer.token(),
        era,
      });
      const result = await client.callTool({
        name: "ask",
        arguments: {
          area: ask.area,
          action_link: "http://example.com/not-https",
          priority: "high",
        },
      });
      const refusal = refusalOf(result);
      expect(refusal.code).toBe("invalid_input");
      expect(refusal.class).toBe("do not retry");
      for (const field of [
        "summary",
        "spoken_detail",
        "action_link",
        "priority",
      ]) {
        expect(refusal.message).toContain(field);
      }
      await client.close();
    });
  },
);

describe("a verified token without asks:create", () => {
  it.each(eras)(
    "gets insufficient_scope from ask, %s handshake",
    async (era) => {
      const client = await connect(handler, {
        token: await issuer.token({ claims: { scope: "openid profile" } }),
        era,
      });
      const refusal = refusalOf(
        await client.callTool({ name: "ask", arguments: ask }),
      );
      expect(refusal.code).toBe("insufficient_scope");
      expect(refusal.class).toBe("do not retry");
      await client.close();
    },
  );

  it("reads the scope from scp when Clerk sends a list", async () => {
    const client = await connect(handler, {
      token: await issuer.token({
        claims: { scope: undefined, scp: ["openid", "asks:create"] },
      }),
    });
    const result = await client.callTool({ name: "ask", arguments: ask });
    expect(result.structuredContent).toEqual({
      id: fixedAskId,
      status: "posted",
    });
    await client.close();
  });
});

describe("a token the service cannot accept", () => {
  const refused = async (token: string) => {
    const seen: Response[] = [];
    await expect(connect(handler, { token, seen })).rejects.toThrow();
    expect(seen[0]?.status).toBe(401);
    expect(seen[0]?.headers.get("www-authenticate")).toContain(
      `resource_metadata="${metadataUrl}"`,
    );
  };

  it("is refused when expired", async () => {
    const now = Math.floor(Date.now() / 1000);
    await refused(
      await issuer.token({ claims: { iat: now - 7200, exp: now - 3600 } }),
    );
  });

  it("is refused when it is a sign-in session token, not an OAuth access token", async () => {
    await refused(await issuer.token({ typ: "JWT" }));
  });

  it("is refused when it names no account", async () => {
    await refused(await issuer.token({ claims: { sub: undefined } }));
  });

  it("is refused when it is not a token at all", async () => {
    await refused("not-a-token");
  });
});

describe("a request the handler cannot use", () => {
  it("is answered 404 when no route matches", async () => {
    const response = await invoke(
      handler,
      new Request(`${new URL(mcpUrl).origin}/elsewhere`, {
        headers: { authorization: `Bearer ${await issuer.token()}` },
      }),
    );
    expect(response.status).toBe(404);
  });

  // The SDK answers a failure of its own with a 500 and logs nothing, so the
  // handler logs it, and the error alarm sees it (logging.md).
  it("is logged as a failure when the MCP server cannot be built", async () => {
    const capture = captureLogs();
    const register = vi
      .spyOn(McpServer.prototype, "registerTool")
      .mockImplementationOnce(() => {
        throw new Error("Could not register");
      });
    try {
      const seen: Response[] = [];
      await expect(
        connect(handler, { token: await issuer.token(), seen }),
      ).rejects.toThrow();
      expect(seen[0]?.status).toBe(500);
      expect(
        capture.lines.some(
          (line) =>
            line.method === "error" &&
            lineText(line).includes("request-failed") &&
            lineText(line).includes("500"),
        ),
      ).toBe(true);
    } finally {
      register.mockRestore();
      capture.restore();
    }
  });

  // API Gateway always sends a well-formed event, so this is a fault on
  // askme's side, answered as service_unavailable is (ADR 11).
  it("is answered 503 when the event is not one API Gateway sends", async () => {
    const result = z
      .object({ statusCode: z.number() })
      .parse(await handler({ hello: "world" }));
    expect(result.statusCode).toBe(503);
  });
});

// The service holds no live connections (polling.md). On the 2026-07-28
// revision a client can ask to keep a stream open for change notifications,
// and it is refused at once.
describe("a modern client that asks to listen for changes", () => {
  it("is refused at once, with no stream left open", async () => {
    const client = await connect(handler, {
      token: await issuer.token(),
      era: "modern",
    });
    await expect(client.listen({ toolsListChanged: true })).rejects.toThrow(
      /Subscription limit reached/u,
    );
    await client.close();
  });
});
