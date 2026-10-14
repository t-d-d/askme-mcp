import type { Client } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { agentAsk } from "../test/asks";
import { newAccount } from "../test/caller";
import { useFakeIssuer } from "../test/identity";
import { invoke } from "../test/lambda";
import { captureLogs, lineText } from "../test/logs";
import { connect, eras, mcpUrl, metadataUrl, refusalOf } from "../test/mcp";
import { limits } from "./src/ask";
import { handler } from "./src/handler";
import { instructions } from "./src/instructions";

const posted = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{24}$/u),
  status: z.literal("posted"),
});

const issuer = useFakeIssuer();

const ask = {
  ...agentAsk,
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
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.json()).toEqual({
      resource: mcpUrl,
      authorization_servers: [issuer.issuer],
      scopes_supported: ["asks:create"],
      bearer_methods_supported: ["header"],
      resource_name: "askme",
    });
  });

  // The SDK's browser client sends MCP-Protocol-Version on the metadata GET,
  // so the browser asks first.
  it("answers a browser's preflight so that the GET may go ahead", async () => {
    const response = await invoke(
      handler,
      new Request(metadataUrl, {
        method: "OPTIONS",
        headers: {
          origin: "https://client.example",
          "access-control-request-method": "GET",
          "access-control-request-headers": "mcp-protocol-version",
        },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toBe("GET");
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "mcp-protocol-version",
    );
  });

  it("leaves the MCP endpoint without a preflight answer", async () => {
    const response = await invoke(
      handler,
      new Request(mcpUrl, { method: "OPTIONS" }),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe.each(eras)(
  "a verified token with asks:create, %s handshake",
  (era) => {
    it("reaches two tools, ask and resolve", async () => {
      const client = await connect(handler, {
        token: await issuer.token(),
        era,
      });
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual(["ask", "resolve"]);
      await client.close();
    });

    it("is sent the server's instructions", async () => {
      const client = await connect(handler, {
        token: await issuer.token(),
        era,
      });
      expect(client.getInstructions()).toBe(instructions);
      await client.close();
    });

    // The tool list never changes, so askme promises no change notices. A
    // client that is promised them asks to listen for them (polling.md).
    it("is told the tool list does not change", async () => {
      const client = await connect(handler, {
        token: await issuer.token(),
        era,
      });
      expect(client.getServerCapabilities()).toEqual({
        tools: { listChanged: false },
      });
      await client.close();
    });

    it("gets a new id back from each new ask", async () => {
      const client = await connect(handler, {
        token: await issuer.token({ claims: { sub: newAccount() } }),
        era,
      });
      const post = async (summary: string) => {
        const result = await client.callTool({
          name: "ask",
          arguments: { ...ask, summary },
        });
        expect(result.isError).not.toBe(true);
        return posted.parse(result.structuredContent).id;
      };
      const ids = [await post("First"), await post("Second")];
      expect(new Set(ids).size).toBe(2);
      await client.close();
    });

    it("gets the first id back from an identical ask", async () => {
      const client = await connect(handler, {
        token: await issuer.token({ claims: { sub: newAccount() } }),
        era,
      });
      const post = async () =>
        posted.parse(
          (await client.callTool({ name: "ask", arguments: ask }))
            .structuredContent,
        ).id;
      const first = await post();
      expect(await post()).toBe(first);
      await client.close();
    });

    it("refuses an ask that breaks a limit, naming every field and its limit", async () => {
      const client = await connect(handler, {
        token: await issuer.token(),
        era,
      });
      const over = (limit: number) => "x".repeat(limit + 1);
      const result = await client.callTool({
        name: "ask",
        arguments: {
          summary: over(limits.summary),
          area: over(limits.area),
          spoken_detail: over(limits.spokenDetail),
          action_link: `https://example.com/${over(limits.link)}`,
          session_link: "https://claude.ai/code/session_1",
        },
      });
      const refusal = refusalOf(result);
      expect(refusal.code).toBe("invalid_input");
      expect(refusal.class).toBe("do not retry");
      expect(refusal.message).toContain(
        `summary: is longer than ${String(limits.summary)} characters`,
      );
      expect(refusal.message).toContain(
        `area: is longer than ${String(limits.area)} characters`,
      );
      expect(refusal.message).toContain(
        `spoken_detail: is longer than ${String(limits.spokenDetail)} characters`,
      );
      expect(refusal.message).toContain(
        `action_link: is longer than ${String(limits.link)} characters`,
      );
      expect(refusal.message).not.toContain("session_link");
      await client.close();
    });

    it("refuses an ask whose text is empty or only spaces", async () => {
      const client = await connect(handler, {
        token: await issuer.token(),
        era,
      });
      const refusal = refusalOf(
        await client.callTool({
          name: "ask",
          arguments: { ...ask, summary: "   ", area: "" },
        }),
      );
      expect(refusal.code).toBe("invalid_input");
      expect(refusal.message).toContain("summary: is empty");
      expect(refusal.message).toContain("area: is empty");
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

const resolved = (id: string) => ({ id, status: "resolved" });

describe.each(eras)("resolving and replacing, %s handshake", (era) => {
  // A new account per test, so no test's ask is a repeat of another's.
  const client = async () =>
    connect(handler, {
      token: await issuer.token({ claims: { sub: newAccount() } }),
      era,
    });

  const post = async (agent: Client) =>
    posted.parse(
      (await agent.callTool({ name: "ask", arguments: ask })).structuredContent,
    ).id;

  it("resolves an ask it posted, answering with its id", async () => {
    const agent = await client();
    const id = await post(agent);
    const result = await agent.callTool({
      name: "resolve",
      arguments: { id },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(resolved(id));
    await agent.close();
  });

  it("answers a resolve of an ask already closed the same way", async () => {
    const agent = await client();
    const id = await post(agent);
    const first = await agent.callTool({ name: "resolve", arguments: { id } });
    const second = await agent.callTool({ name: "resolve", arguments: { id } });
    expect(second.isError).not.toBe(true);
    expect(second.structuredContent).toEqual(first.structuredContent);
    expect(second.content).toEqual(first.content);
    await agent.close();
  });

  it("refuses an id this account has no ask for as not_found, not to be retried", async () => {
    const agent = await client();
    const refusal = refusalOf(
      await agent.callTool({
        name: "resolve",
        arguments: { id: "AAAAAAAAAAAAAAAAAAAAAAAA" },
      }),
    );
    expect(refusal.code).toBe("not_found");
    expect(refusal.class).toBe("do not retry");
    expect(refusal.message).toContain("Do not retry");
    expect(refusal.message).toMatch(/carry on/iu);
    await agent.close();
  });

  it("refuses a resolve with no id as invalid_input", async () => {
    const agent = await client();
    const refusal = refusalOf(
      await agent.callTool({ name: "resolve", arguments: {} }),
    );
    expect(refusal.code).toBe("invalid_input");
    expect(refusal.message).toContain("id: is missing");
    await agent.close();
  });

  it("posts an ask whose replaces names no ask as a new one", async () => {
    const agent = await client();
    const result = await agent.callTool({
      name: "ask",
      arguments: { ...ask, replaces: "AAAAAAAAAAAAAAAAAAAAAAAA" },
    });
    expect(result.isError).not.toBe(true);
    posted.parse(result.structuredContent);
    await agent.close();
  });
});

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
    expect(posted.safeParse(result.structuredContent).success).toBe(true);
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

  // A class of its own, so the line can be seen to carry it.
  class ServerBuildFailed extends Error {
    constructor() {
      super("Could not register");
      this.name = "ServerBuildFailed";
    }
  }

  // The SDK answers its own failure with a 500 and writes nothing. It hands
  // the handler the error it caught, and the handler logs one line.
  it.each(eras)(
    "is logged once, by its class, when the MCP server cannot be built, %s handshake",
    async (era) => {
      const capture = captureLogs();
      const register = vi
        .spyOn(McpServer.prototype, "registerTool")
        .mockImplementationOnce(() => {
          throw new ServerBuildFailed();
        });
      try {
        const seen: Response[] = [];
        await expect(
          connect(handler, { token: await issuer.token(), era, seen }),
        ).rejects.toThrow();
        expect(seen.map((answer) => answer.status)).toEqual([500]);
        const failures = capture.lines.filter(
          (line) => line.method === "error",
        );
        expect(failures).toHaveLength(1);
        expect(failures[0]?.args[0]).toMatchObject({
          event: "request-failed",
          status: 500,
          errorClass: "ServerBuildFailed",
        });
        expect(capture.lines.map(lineText).join("\n")).not.toContain(
          "Could not register",
        );
      } finally {
        register.mockRestore();
        capture.restore();
      }
    },
  );

  // API Gateway always sends a well-formed event, so this is askme's fault
  // (ADR 11).
  it("is answered 503 with service_unavailable when the event is not one API Gateway sends", async () => {
    const result = z
      .object({ statusCode: z.number(), body: z.string() })
      .parse(await handler({ hello: "world" }));
    expect(result.statusCode).toBe(503);
    const refusal = z
      .strictObject({
        code: z.string(),
        class: z.string(),
        message: z.string(),
      })
      .parse(JSON.parse(result.body));
    expect(refusal.code).toBe("service_unavailable");
    expect(refusal.class).toBe("retry");
  });

  // The handler reads every route's answer out with Response's text, so making
  // the first read throw makes the handler's own failure path answer.
  async function failingOnce(request: Request): Promise<Response> {
    const capture = captureLogs();
    const text = vi
      .spyOn(Response.prototype, "text")
      .mockImplementationOnce(() => {
        throw new Error("Could not answer");
      });
    try {
      return await invoke(handler, request);
    } finally {
      text.mockRestore();
      capture.restore();
    }
  }

  // A browser-based client must be able to read the 503's code.
  it("answers the metadata's failure with a 503 a browser may read", async () => {
    const response = await failingOnce(new Request(metadataUrl));
    expect(response.status).toBe(503);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(
      z.object({ code: z.string() }).parse(await response.json()).code,
    ).toBe("service_unavailable");
  });

  it("answers the MCP endpoint's failure with a 503 that allows no other origin", async () => {
    const response = await failingOnce(new Request(mcpUrl, { method: "POST" }));
    expect(response.status).toBe(503);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers a page route's failure with a 503 that allows no other origin", async () => {
    const response = await failingOnce(
      new Request(`${new URL(mcpUrl).origin}/api/asks`),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});

// The service holds no live connections (polling.md). The spec has a server
// acknowledge only the notices it will send, and end a stream it ends itself
// with a completion result.
describe("a modern client that asks to listen for changes", () => {
  it("is told nothing will be sent, and the stream ends at once", async () => {
    const client = await connect(handler, {
      token: await issuer.token(),
      era: "modern",
    });
    const subscription = await client.listen({
      toolsListChanged: true,
      promptsListChanged: true,
      resourcesListChanged: true,
      resourceSubscriptions: [mcpUrl],
    });
    expect(subscription.honoredFilter).toEqual({});
    expect(await subscription.closed).toBe("graceful");
    await client.close();
  });
});
