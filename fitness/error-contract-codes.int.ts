// Kept apart from error-contract.int.ts, which runs against a store that
// cannot be reached.
import { ProtocolErrorCode } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { afterAll, afterEach, describe, expect, inject, it, vi } from "vitest";
import { z } from "zod";
import { askTool } from "../service/src/ask";
import { codes, type Code } from "../service/src/errors";
import { handler } from "../service/src/handler";
import { rateLimits } from "../service/src/rate";
import { createStore, dailyAskCap } from "../service/src/store/store";
import { agentAsk } from "../test/asks";
import { accountId, newAccount } from "../test/caller";
import { noon, stopClockAt } from "../test/clock";
import { useFakeIssuer, type TokenOptions } from "../test/identity";
import { connect, eras, refusalOf } from "../test/mcp";
import { storeAsk } from "../test/store-ask";

const endpoint = inject("databaseEndpoint");
const tableName = inject("tableName");
const store = createStore({ tableName, endpoint });

const issuer = useFakeIssuer();
afterEach(() => {
  vi.useRealTimers();
});
afterAll(() => {
  store.close();
});

const ask = agentAsk;

const numbered = (n: number) => storeAsk({ summary: `Ask ${String(n)}` });

async function call(
  sub: string,
  name: string,
  args: Record<string, string>,
  token: TokenOptions = {},
): Promise<unknown> {
  const agent = await connect(handler, {
    token: await issuer.token({
      ...token,
      claims: { sub, ...token.claims },
    }),
  });
  try {
    return await agent.callTool({ name, arguments: args });
  } finally {
    await agent.close();
  }
}

const cases: { code: Code; provoke: () => Promise<unknown> }[] = [
  {
    code: "invalid_input",
    provoke: () => call(newAccount(), "ask", { ...ask, summary: "" }),
  },
  {
    code: "cap_reached",
    provoke: async () => {
      // The day's asks, one a minute through the morning, so no minute is
      // over its rate.
      const sub = newAccount();
      for (let n = 1; n <= dailyAskCap; n += 1) {
        await store.postAsk(
          accountId(sub),
          numbered(n),
          new Date(noon.getTime() - n * 60_000),
        );
      }
      stopClockAt(noon);
      return call(sub, "ask", ask);
    },
  },
  {
    code: "not_found",
    provoke: () =>
      call(newAccount(), "resolve", { id: "AAAAAAAAAAAAAAAAAAAAAAAA" }),
  },
  {
    code: "insufficient_scope",
    provoke: () =>
      call(newAccount(), "ask", ask, { claims: { scope: "openid" } }),
  },
  {
    code: "rate_limited",
    provoke: async () => {
      const sub = newAccount();
      for (let n = 1; n <= rateLimits.ask.limit; n += 1) {
        await store.countCall(accountId(sub), "ask", noon);
      }
      stopClockAt(noon);
      return call(sub, "ask", ask);
    },
  },
  {
    code: "service_unavailable",
    provoke: async () => {
      const run = vi
        .spyOn(askTool, "run")
        .mockRejectedValueOnce(new Error("Something askme did not expect"));
      try {
        return await call(newAccount(), "ask", ask);
      } finally {
        run.mockRestore();
      }
    },
  },
];

describe("fitness: every code arrives as a tool result (error-contract.md)", () => {
  it("provokes every code in the table", () => {
    expect(cases.map(({ code }) => code).sort()).toEqual(
      Object.keys(codes).sort(),
    );
  });

  it.each(cases)(
    "sends $code as a tool result marked as an error, with its code and class",
    async ({ code, provoke }) => {
      const result = await provoke();
      expect(z.object({ isError: z.boolean() }).parse(result).isError).toBe(
        true,
      );
      const refusal = refusalOf(result);
      expect(refusal.code).toBe(code);
      expect(refusal.class).toBe(codes[code]);
      expect(refusal.message.length).toBeGreaterThan(0);
    },
    20_000,
  );
});

// A tool name askme does not have is not a refusal. The SDK answers it with
// the protocol error the MCP spec asks for, before any tool runs (ADR 19).
describe.each(eras)(
  "fitness: an unknown tool name gets the protocol error (error-contract.md), %s handshake",
  (era) => {
    it("answers a call to a tool askme does not have with JSON-RPC error -32602, naming the tool", async () => {
      const agent = await connect(handler, {
        token: await issuer.token({ claims: { sub: newAccount() } }),
        era,
      });
      try {
        const answer = agent.callTool({ name: "asks", arguments: ask });
        await expect(answer).rejects.toMatchObject({
          code: ProtocolErrorCode.InvalidParams,
        });
        await expect(answer).rejects.toThrow("Tool asks not found");
      } finally {
        await agent.close();
      }
    });
  },
);

// After the token is checked, the SDK answers a failure of its own before any
// tool runs. askme keeps that answer and adds nothing (ADR 24).
describe.each(eras)(
  "fitness: a failure while the SDK holds the call keeps the SDK's answer (error-contract.md), %s handshake",
  (era) => {
    it("answers with HTTP 500 and JSON-RPC error -32603 when the MCP server cannot be built", async () => {
      const register = vi
        .spyOn(McpServer.prototype, "registerTool")
        .mockImplementationOnce(() => {
          throw new Error("Could not register");
        });
      try {
        const seen: Response[] = [];
        await expect(
          connect(handler, {
            token: await issuer.token({ claims: { sub: newAccount() } }),
            era,
            seen,
          }),
        ).rejects.toThrow();
        const [answer] = seen;
        expect(answer?.status).toBe(500);
        z.object({
          error: z.object({ code: z.literal(ProtocolErrorCode.InternalError) }),
          // The id of the call that failed, so the client can match it.
          id: z.union([z.string(), z.number()]),
        }).parse(await answer?.json());
      } finally {
        register.mockRestore();
      }
    });
  },
);

const posted = z.object({
  structuredContent: z.object({ id: z.string(), status: z.literal("posted") }),
});
const resolved = z.object({
  structuredContent: z.object({
    id: z.string(),
    status: z.literal("resolved"),
  }),
});

describe("fitness: a repeat is safe (error-contract.md)", () => {
  it("answers the same ask sent twice with one id", async () => {
    const sub = newAccount();
    const first = posted.parse(await call(sub, "ask", ask));
    const second = posted.parse(await call(sub, "ask", ask));
    expect(second.structuredContent.id).toBe(first.structuredContent.id);
  });

  it("answers the same resolve sent twice with success, twice", async () => {
    const sub = newAccount();
    const { id } = posted.parse(await call(sub, "ask", ask)).structuredContent;
    const answers = [
      await call(sub, "resolve", { id }),
      await call(sub, "resolve", { id }),
    ];
    for (const answer of answers) {
      expect(resolved.parse(answer).structuredContent).toEqual({
        id,
        status: "resolved",
      });
    }
  });

  it("posts an ask whose replaces names an unknown id", async () => {
    const result = await call(newAccount(), "ask", {
      ...ask,
      replaces: "AAAAAAAAAAAAAAAAAAAAAAAA",
    });
    expect(posted.safeParse(result).success).toBe(true);
  });
});
