import type { Client } from "@modelcontextprotocol/client";
import { afterAll, describe, expect, inject, it } from "vitest";
import { z } from "zod";
import { handler } from "../service/src/handler";
import type { AccountId } from "../service/src/identity";
import {
  askLifetimeDays,
  createStore,
  dedupeWindowMinutes,
  type Posting,
} from "../service/src/store/store";
import { agentAsk } from "../test/asks";
import { accountId, newAccount } from "../test/caller";
import { storedItems } from "../test/dynamodb";
import { useFakeIssuer } from "../test/identity";
import { connect, eras, type Era } from "../test/mcp";

const endpoint = inject("databaseEndpoint");
const tableName = inject("tableName");
const store = createStore({ tableName, endpoint });

const issuer = useFakeIssuer();
afterAll(() => {
  store.close();
});

// Every field an agent can send. replaces names no ask, so the ask is
// posted as new.
const ask = {
  ...agentAsk,
  action_link: "https://github.com/t-d-d/askme-mcp/pull/1",
  session_link: "https://claude.ai/code/session_1",
  replaces: "AAAAAAAAAAAAAAAAAAAAAAAA",
  stale_after_minutes: 45,
};

const changed: Record<keyof typeof ask, string | number> = {
  summary: `${ask.summary}, again`,
  area: "Home renovation, downstairs",
  spoken_detail: `${ask.spoken_detail} Or Monday.`,
  action_link: "https://github.com/t-d-d/askme-mcp/pull/2",
  session_link: "https://claude.ai/code/session_2",
  replaces: "BBBBBBBBBBBBBBBBBBBBBBBB",
  stale_after_minutes: 46,
};

const agentOf = async (sub: string, era: Era = "legacy") =>
  connect(handler, { token: await issuer.token({ claims: { sub } }), era });

const idOf = (result: unknown) =>
  z.object({ structuredContent: z.object({ id: z.string() }) }).parse(result)
    .structuredContent.id;

const post = async (
  agent: Client,
  args: Record<string, string | number> = ask,
) => idOf(await agent.callTool({ name: "ask", arguments: args }));

const asksOf = async (sub: string) =>
  (await storedItems(endpoint, tableName, sub)).filter(
    (item) => typeof item.summary === "string",
  );

const openIdsOf = async (sub: string) =>
  (await store.openAsks(accountId(sub), new Date())).asks.map(({ id }) => id);

const idFrom = (posting: Posting): string => {
  if (posting.kind === "posted" || posting.kind === "matched") {
    return posting.id;
  }
  throw new Error(`The ask was refused: ${posting.kind}`);
};

describe("fitness: same call twice (ask-idempotency.md)", () => {
  it("returns one id and stores one ask", async () => {
    const sub = newAccount();
    const agent = await agentOf(sub);
    try {
      const first = await post(agent);
      expect(await post(agent)).toBe(first);
      expect(await asksOf(sub)).toEqual([
        expect.objectContaining({ id: first }),
      ]);
    } finally {
      await agent.close();
    }
  });

  it("treats whitespace around a field as no difference", async () => {
    const sub = newAccount();
    const agent = await agentOf(sub);
    try {
      const first = await post(agent);
      const padded = Object.fromEntries(
        Object.entries(ask).map(([field, value]) => [
          field,
          typeof value === "string" ? ` ${value}\n` : value,
        ]),
      );
      expect(await post(agent, padded)).toBe(first);
      expect(await asksOf(sub)).toHaveLength(1);
    } finally {
      await agent.close();
    }
  });
});

describe("fitness: closed by the agent is new (ask-idempotency.md)", () => {
  it("makes a new card with a new id when the agent resolved the first ask", async () => {
    const sub = newAccount();
    const agent = await agentOf(sub);
    try {
      const first = await post(agent);
      await agent.callTool({ name: "resolve", arguments: { id: first } });
      const second = await post(agent);
      expect(second).not.toBe(first);
      expect(await openIdsOf(sub)).toEqual([second]);
      expect(await asksOf(sub)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: first, endedAs: "resolved" }),
        ]),
      );
      expect(await asksOf(sub)).toHaveLength(2);
    } finally {
      await agent.close();
    }
  });

  it("makes a new card with a new id when the agent replaced the first ask", async () => {
    const sub = newAccount();
    const agent = await agentOf(sub);
    try {
      const first = await post(agent);
      const replacing = await post(agent, { ...ask, replaces: first });
      const again = await post(agent);
      expect(again).not.toBe(first);
      expect(again).not.toBe(replacing);
      expect((await openIdsOf(sub)).sort()).toEqual([replacing, again].sort());
      expect(await asksOf(sub)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: first, endedAs: "replaced" }),
        ]),
      );
      expect(await asksOf(sub)).toHaveLength(3);
    } finally {
      await agent.close();
    }
  });

  it("matches a repeat of the new ask, as it would any open ask", async () => {
    const sub = newAccount();
    const agent = await agentOf(sub);
    try {
      const first = await post(agent);
      await agent.callTool({ name: "resolve", arguments: { id: first } });
      const second = await post(agent);
      expect(await post(agent)).toBe(second);
      expect(await asksOf(sub)).toHaveLength(2);
    } finally {
      await agent.close();
    }
  });
});

describe("fitness: a dismissal still matches (ask-idempotency.md)", () => {
  it("returns the first id and makes no card when the person dismissed the first ask", async () => {
    const sub = newAccount();
    const agent = await agentOf(sub);
    try {
      const first = await post(agent);
      expect(await store.dismissAsk(accountId(sub), first, new Date())).toBe(
        "dismissed",
      );
      expect(await post(agent)).toBe(first);
      expect(await asksOf(sub)).toEqual([
        expect.objectContaining({ id: first, endedAs: "dismissed" }),
      ]);
    } finally {
      await agent.close();
    }
  });
});

describe("fitness: expired is new (ask-idempotency.md)", () => {
  const newAsk = {
    summary: ask.summary,
    area: ask.area,
    spokenDetail: ask.spoken_detail,
  };
  const start = new Date("2026-10-11T09:30:00.000Z");
  const at = (ms: number) => new Date(start.getTime() + ms);
  const lifetime = askLifetimeDays * 86_400_000;
  const later = at(lifetime + 60_000);

  // A replacing ask keeps the expiry of the ask it replaces (ADR 13), so
  // the first ask here expires two minutes after it is posted.
  const postFirst = async (owner: AccountId) => {
    const oldest = idFrom(await store.postAsk(owner, newAsk, start));
    const replacing = { ...newAsk, replaces: oldest };
    const first = idFrom(
      await store.postAsk(owner, replacing, at(lifetime - 120_000)),
    );
    return { first, repeat: () => store.postAsk(owner, replacing, later) };
  };

  const openIdsAt = async (owner: AccountId, now: Date) =>
    (await store.openAsks(owner, now)).asks.map(({ id }) => id);

  it("makes a new card with a new id when the first ask expired, never closed, inside the window", async () => {
    const owner = accountId(newAccount());
    const { first, repeat } = await postFirst(owner);
    expect(await openIdsAt(owner, later)).toEqual([]);

    const again = idFrom(await repeat());
    expect(again).not.toBe(first);
    expect(await openIdsAt(owner, later)).toEqual([again]);
    expect(await asksOf(owner)).toHaveLength(3);
  });

  it("makes a new card with a new id when the person dismissed the first ask and it then expired", async () => {
    const owner = accountId(newAccount());
    const { first, repeat } = await postFirst(owner);
    expect(await store.dismissAsk(owner, first, at(lifetime - 60_000))).toBe(
      "dismissed",
    );

    const again = idFrom(await repeat());
    expect(again).not.toBe(first);
    expect(await openIdsAt(owner, later)).toEqual([again]);
  });
});

describe("fitness: two at once after a close (ask-idempotency.md)", () => {
  it("stores one new ask when two identical asks arrive together after a resolve", async () => {
    const sub = newAccount();
    const agents = await Promise.all([agentOf(sub), agentOf(sub)]);
    try {
      const first = await post(agents[0]);
      await agents[0].callTool({ name: "resolve", arguments: { id: first } });
      const ids = await Promise.all(agents.map((agent) => post(agent)));
      expect(new Set(ids).size).toBe(1);
      expect(ids[0]).not.toBe(first);
      expect(await asksOf(sub)).toHaveLength(2);
    } finally {
      await Promise.all(agents.map((agent) => agent.close()));
    }
  });
});

describe("fitness: two at once (ask-idempotency.md)", () => {
  it("stores one ask when two identical asks arrive at the same moment", async () => {
    const sub = newAccount();
    const agents = await Promise.all([agentOf(sub), agentOf(sub)]);
    try {
      const ids = await Promise.all(agents.map((agent) => post(agent)));
      expect(new Set(ids).size).toBe(1);
      expect(await asksOf(sub)).toHaveLength(1);
    } finally {
      await Promise.all(agents.map((agent) => agent.close()));
    }
  });
});

describe("fitness: any difference is new (ask-idempotency.md)", () => {
  it.each(Object.entries(changed))(
    "makes a new ask when only the %s changes",
    async (field, value) => {
      const sub = newAccount();
      const agent = await agentOf(sub);
      try {
        const first = await post(agent);
        const second = await post(agent, { ...ask, [field]: value });
        expect(second).not.toBe(first);
        expect(await asksOf(sub)).toHaveLength(2);
      } finally {
        await agent.close();
      }
    },
  );

  it.each(["action_link", "session_link", "replaces", "stale_after_minutes"])(
    "makes a new ask when only the %s is left out",
    async (field) => {
      const sub = newAccount();
      const agent = await agentOf(sub);
      try {
        const first = await post(agent);
        const without = Object.fromEntries(
          Object.entries(ask).filter(([name]) => name !== field),
        );
        expect(await post(agent, without)).not.toBe(first);
        expect(await asksOf(sub)).toHaveLength(2);
      } finally {
        await agent.close();
      }
    },
  );
});

describe("fitness: the window ends (ask-idempotency.md)", () => {
  it(`matches an identical ask for ${String(dedupeWindowMinutes)} minutes, and makes a new one after`, async () => {
    const owner = accountId(newAccount());
    const newAsk = {
      summary: ask.summary,
      area: ask.area,
      spokenDetail: ask.spoken_detail,
    };
    const first = new Date("2026-10-11T09:30:00.000Z");
    const at = (ms: number) => new Date(first.getTime() + ms);
    const window = dedupeWindowMinutes * 60_000;

    const id = idFrom(await store.postAsk(owner, newAsk, first));
    expect(idFrom(await store.postAsk(owner, newAsk, at(window - 1000)))).toBe(
      id,
    );
    const later = idFrom(await store.postAsk(owner, newAsk, at(window)));
    expect(later).not.toBe(id);
    expect(await asksOf(owner)).toHaveLength(2);
  });
});

describe("fitness: accounts are separate (ask-idempotency.md)", () => {
  it("makes two asks of the same content on two accounts", async () => {
    const [one, two] = [newAccount(), newAccount()];
    const [first, second] = await Promise.all([agentOf(one), agentOf(two)]);
    try {
      const ids = [await post(first), await post(second)];
      expect(new Set(ids).size).toBe(2);
      expect(await asksOf(one)).toEqual([
        expect.objectContaining({ id: ids[0] }),
      ]);
      expect(await asksOf(two)).toEqual([
        expect.objectContaining({ id: ids[1] }),
      ]);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });
});

describe.each(eras)(
  "fitness: replies look the same (ask-idempotency.md), %s handshake",
  (era) => {
    it("answers a deduplicated call exactly as it answered the first", async () => {
      const agent = await agentOf(newAccount(), era);
      try {
        const fresh = await agent.callTool({ name: "ask", arguments: ask });
        const repeat = await agent.callTool({ name: "ask", arguments: ask });
        expect(fresh.isError).not.toBe(true);
        expect(repeat).toEqual(fresh);
      } finally {
        await agent.close();
      }
    });
  },
);
