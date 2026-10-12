import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Client } from "@modelcontextprotocol/client";
import { handler, routes } from "../service/src/handler";
import { instructions } from "../service/src/instructions";
import { askChangePaths, pagePaths } from "../shared/page-api";
import { startFakeIssuer, type FakeIssuer } from "../test/identity";
import { invoke } from "../test/lambda";
import { connect, eras, origin, type Era } from "../test/mcp";

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
  spoken_detail: "The electrician needs a yes or no before Friday.",
  action_link: "https://github.com/t-d-d/askme-mcp/pull/1",
  session_link: "https://claude.ai/code/session_1",
};

const serverInfo = {
  "io.modelcontextprotocol/serverInfo": { name: "askme", version: "1.0.0" },
};

// A refusal from the page's API: a code, its class and a message, and
// nothing about the account.
const refusalSchema = z.strictObject({
  code: z.string(),
  class: z.string(),
  message: z.string(),
});

// An id and a status, and nothing else (ADR 2).
const idAndStatus = z.strictObject({
  id: z.string(),
  status: z.enum(["posted", "resolved"]),
});

const newAccount = () => `user_${randomUUID().slice(0, 8)}`;

// An id of the same shape as askme's, that no account has.
const unknownId = () => randomBytes(18).toString("base64url");

const agentOf = async (sub: string, era: Era = "legacy") =>
  connect(handler, { token: await issuer.token({ claims: { sub } }), era });

const postAs = async (agent: Client, args: Record<string, string> = ask) =>
  idAndStatus.parse(
    (await agent.callTool({ name: "ask", arguments: args })).structuredContent,
  ).id;

// What the page shows the account: the version, and the open asks' ids.
async function pageOf(sub: string) {
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
      asks: z.array(z.object({ id: z.string() })),
    })
    .parse(await response.json());
}

describe.each(eras)(
  "fitness: the tool list is fixed (agents-write-only.md), %s handshake",
  (era) => {
    it("advertises exactly ask and resolve", async () => {
      const client = await connect(handler, {
        token: await issuer.token(),
        era,
      });
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual(["ask", "resolve"]);
      await client.close();
    });
  },
);

describe.each(eras)(
  "fitness: results carry no account data (agents-write-only.md), %s handshake",
  (era) => {
    it("advertises an answer that holds an id and a status only", async () => {
      const client = await connect(handler, {
        token: await issuer.token(),
        era,
      });
      const { tools } = await client.listTools();
      const properties = tools.map((tool) =>
        Object.keys(tool.outputSchema?.properties ?? {}).sort(),
      );
      expect(properties).toEqual([
        ["id", "status"],
        ["id", "status"],
      ]);
      await client.close();
    });

    it("answers an account that already has asks with an id and a status only", async () => {
      const client = await connect(handler, {
        token: await issuer.token({
          claims: { sub: `user_${randomUUID().slice(0, 8)}` },
        }),
        era,
      });
      const postAndCheck = async () => {
        const { _meta: meta, ...result } = await client.callTool({
          name: "ask",
          arguments: ask,
        });
        expect(Object.keys(result).sort()).toEqual(
          ["content", "structuredContent"].sort(),
        );
        // The 2026-07-28 revision names the server on every result. It is
        // the same for every account.
        if (meta !== undefined) expect(meta).toEqual(serverInfo);
        const answer = idAndStatus.parse(result.structuredContent);
        expect(result.content).toEqual([
          { type: "text", text: JSON.stringify(answer) },
        ]);
      };
      await postAndCheck();
      await postAndCheck();
      await client.close();
    });

    it("answers a resolve with an id and a status only, however the ask was closed", async () => {
      const client = await agentOf(newAccount(), era);
      const id = await postAs(client);
      const resolveAndCheck = async () => {
        const { _meta: meta, ...result } = await client.callTool({
          name: "resolve",
          arguments: { id },
        });
        expect(Object.keys(result).sort()).toEqual(
          ["content", "structuredContent"].sort(),
        );
        if (meta !== undefined) expect(meta).toEqual(serverInfo);
        expect(idAndStatus.parse(result.structuredContent)).toEqual({
          id,
          status: "resolved",
        });
        return result;
      };
      const first = await resolveAndCheck();
      expect(await resolveAndCheck()).toEqual(first);
      await client.close();
    });
  },
);

describe("fitness: ids cannot be guessed or borrowed (agents-write-only.md)", () => {
  it("gives every ask a long random id", async () => {
    const client = await agentOf(newAccount());
    const ids: string[] = [];
    for (let n = 0; n < 20; n += 1) {
      ids.push(await postAs(client, { ...ask, summary: `Ask ${String(n)}` }));
    }
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{24}$/u);
    expect(new Set(ids).size).toBe(ids.length);
    await client.close();
  });

  it("refuses to resolve another account's ask exactly as it refuses an id that does not exist", async () => {
    const [owner, other] = [newAccount(), newAccount()];
    const ownerAgent = await agentOf(owner);
    const id = await postAs(ownerAgent);
    await ownerAgent.close();
    const before = await pageOf(owner);

    const otherAgent = await agentOf(other);
    const borrowed = await otherAgent.callTool({
      name: "resolve",
      arguments: { id },
    });
    const unknown = await otherAgent.callTool({
      name: "resolve",
      arguments: { id: unknownId() },
    });
    await otherAgent.close();

    expect(borrowed.isError).toBe(true);
    expect(borrowed).toEqual(unknown);
    expect(await pageOf(owner)).toEqual(before);
  });

  it("posts an ask that names another account's ask in replaces as new, and leaves that one open", async () => {
    const [owner, other] = [newAccount(), newAccount()];
    const ownerAgent = await agentOf(owner);
    const id = await postAs(ownerAgent);
    await ownerAgent.close();
    const before = await pageOf(owner);

    const otherAgent = await agentOf(other);
    const replacing = await postAs(otherAgent, { ...ask, replaces: id });
    await otherAgent.close();

    expect(await pageOf(owner)).toEqual(before);
    expect(await pageOf(other)).toEqual({
      version: 1,
      asks: [{ id: replacing }],
    });
  });
});

describe.each(eras)(
  "fitness: instructions are the same for all (agents-write-only.md), %s handshake",
  (era) => {
    // What a client is told before it calls anything: the server's
    // instructions, and each tool with its description and schemas.
    const toldTo = async (token: string) => {
      const client = await connect(handler, { token, era });
      const told = {
        instructions: client.getInstructions(),
        tools: (await client.listTools()).tools,
      };
      await client.close();
      return told;
    };

    it("tells every account, and every connection, the same", async () => {
      const first = await toldTo(await issuer.token());
      const second = await toldTo(
        await issuer.token({
          claims: { sub: newAccount(), client_id: "client_other" },
        }),
      );
      expect(first.instructions).toBe(instructions);
      expect(second).toEqual(first);
    });
  },
);

describe("fitness: an agent's token reads nothing from the page's API (agents-write-only.md)", () => {
  const pageRoutes = Object.entries(routes)
    .filter(([, access]) => access === "page")
    .map(([route]) => route);

  // A token that carries asks:create and nothing else, in the form Clerk
  // gives agents, and in the form of a session token. Then an OpenID ID
  // token, which Clerk can give an agent's OAuth client with no scope at
  // all: it names its client as its audience, which a session token never
  // has.
  const agentTokens = () =>
    Promise.all([
      issuer.token({ claims: { scope: "asks:create" } }),
      issuer.token({ claims: { scope: undefined, scp: ["asks:create"] } }),
      issuer.token({ typ: "JWT", claims: { scope: "asks:create" } }),
      issuer.sessionToken({ claims: { scope: "asks:create" } }),
      issuer.sessionToken({ claims: { aud: "client_test" } }),
    ]);

  it("finds the page's routes, the rules and their hashtags, and the changes to an ask, among them", () => {
    expect(pageRoutes).toEqual(
      expect.arrayContaining([
        "GET /api/asks",
        "GET /api/connection",
        "GET /api/rules",
        "PUT /api/rules",
        "POST /api/asks/opened",
        "POST /api/asks/dismissed",
      ]),
    );
  });

  it.each(pageRoutes)(
    "refuses an agent's token on %s, such as one carrying only asks:create",
    async (route) => {
      const [method = "", path = ""] = route.split(" ");
      for (const token of await agentTokens()) {
        const response = await invoke(
          handler,
          new Request(`${origin}${path}`, {
            method,
            headers: { authorization: `Bearer ${token}` },
          }),
        );
        expect(response.status).toBe(403);
        const refusal = refusalSchema.parse(await response.json());
        expect(refusal.code).toBe("insufficient_scope");
        expect(refusal.class).toBe("do not retry");
      }
    },
  );

  // The agent's own account, and one of its own asks, so only the token
  // stands between the call and the change.
  it.each(Object.values(askChangePaths))(
    "changes nothing when an agent's token sends %s an ask of its own account",
    async (path) => {
      const sub = newAccount();
      const agent = await agentOf(sub);
      const id = await postAs(agent);
      await agent.close();
      const before = await pageOf(sub);
      const tokens = await Promise.all([
        issuer.token({ claims: { sub, scope: "asks:create" } }),
        issuer.token({
          claims: { sub, scope: undefined, scp: ["asks:create"] },
        }),
        issuer.sessionToken({ claims: { sub, scope: "asks:create" } }),
        issuer.sessionToken({ claims: { sub, aud: "client_test" } }),
      ]);
      for (const token of tokens) {
        const response = await invoke(
          handler,
          new Request(`${origin}${path}`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ id }),
          }),
        );
        expect(response.status).toBe(403);
      }
      expect(await pageOf(sub)).toEqual(before);
    },
  );
});
