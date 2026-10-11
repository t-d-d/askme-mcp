import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { handler, routes } from "../service/src/handler";
import { startFakeIssuer, type FakeIssuer } from "../test/identity";
import { invoke } from "../test/lambda";
import { connect, eras, origin } from "../test/mcp";

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
  status: z.literal("posted"),
});

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
      expect(properties).toEqual([["id", "status"]]);
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

  it("finds the page's routes", () => {
    expect(pageRoutes).toEqual(
      expect.arrayContaining(["GET /api/asks", "GET /api/connection"]),
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
});
