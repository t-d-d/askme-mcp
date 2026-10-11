// The error contract through the official MCP client, against a working
// store (ADR 11). error-contract.int.ts runs against a store that cannot be
// reached, so these are kept apart from it.
import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  inject,
  it,
  vi,
} from "vitest";
import { z } from "zod";
import { askTool } from "../service/src/ask";
import { codes, type Code } from "../service/src/errors";
import { handler } from "../service/src/handler";
import { callerOf, type AccountId } from "../service/src/identity";
import {
  asksPerMinute,
  createStore,
  dailyAskCap,
} from "../service/src/store/store";
import {
  startFakeIssuer,
  type FakeIssuer,
  type TokenOptions,
} from "../test/identity";
import { connect, refusalOf } from "../test/mcp";

const endpoint = inject("databaseEndpoint");
const tableName = inject("tableName");
const store = createStore({ tableName, endpoint });

let issuer: FakeIssuer;
beforeAll(async () => {
  issuer = await startFakeIssuer();
  vi.stubEnv("CLERK_ISSUER", issuer.issuer);
});
afterEach(() => {
  vi.useRealTimers();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  store.close();
  await issuer.close();
});

const newAccount = () => `user_${randomUUID().slice(0, 8)}`;

const accountId = (sub: string): AccountId =>
  callerOf({
    token: "test",
    clientId: "test",
    scopes: [],
    extra: { accountId: sub, requestId: "r" },
  }).accountId;

const ask = {
  summary: "Approve the plan for the kitchen rewiring",
  area: "Home renovation",
  spoken_detail: "The electrician needs a yes or no before Friday.",
};

// An ask of its own for each number, as the store takes it.
const numbered = (n: number) => ({
  summary: `Ask ${String(n)}`,
  area: "Home renovation",
  spokenDetail: "The electrician needs a yes or no.",
});

// The middle of a minute and of a UTC day, so that the day's and the
// minute's counts filled here are the ones the call is counted against.
const noon = new Date("2026-10-11T12:00:30.000Z");

// Stops the clock at a moment, for the service and the token alike.
const stopClockAt = (moment: Date) => {
  vi.useFakeTimers({ toFake: ["Date"], now: moment });
};

// One call through the official client, as an agent of the account.
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
      for (let n = 1; n <= asksPerMinute; n += 1) {
        await store.postAsk(accountId(sub), numbered(n), noon);
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
