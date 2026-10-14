import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { z } from "zod";
import { handler } from "../service/src/handler";
import { reasonLimit } from "../service/src/sort";
import { sortAttempts } from "../service/src/sorter";
import { sortKeys } from "../service/src/store/keys";
import { pagePaths } from "../shared/page-api";
import { storedItems } from "../test/dynamodb";
import { fakes, type ModelCall } from "../test/fakes";
import { runSorts } from "../test/sorts";
import { startFakeIssuer, type FakeIssuer } from "../test/identity";
import { invoke } from "../test/lambda";
import { connect, origin } from "../test/mcp";

let issuer: FakeIssuer;
beforeAll(async () => {
  issuer = await startFakeIssuer();
  vi.stubEnv("CLERK_ISSUER", issuer.issuer);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await issuer.close();
});

const newAccount = () => `user_${randomUUID().slice(0, 8)}`;

const rules = "#work is my day job.\n\n#shop is my online shop.";

const ask = {
  summary: "Merge the fix for checkout rounding?",
  area: "The online shop",
  spoken_detail: "The fix for checkout rounding is ready, and the tests pass.",
  action_link: "https://github.com/example/shop/pull/12",
};

async function saveRules(sub: string) {
  fakes.model.reply({ json: { hashtags: ["work", "shop"], hours: [] } });
  const response = await invoke(
    handler,
    new Request(`${origin}${pagePaths.rules}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${await issuer.sessionToken({ claims: { sub } })}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: rules }),
    }),
  );
  expect(response.status).toBe(200);
}

const idAndStatus = z.strictObject({
  id: z.string(),
  status: z.enum(["posted", "resolved"]),
});

async function callTool(sub: string, name: string, args: object) {
  const client = await connect(handler, {
    token: await issuer.token({ claims: { sub } }),
  });
  try {
    return await client.callTool({
      name,
      arguments: { ...args },
    });
  } finally {
    await client.close();
  }
}

const sortingCallsFor = (summary: string): ModelCall[] =>
  fakes.model.calls.filter((call) =>
    JSON.stringify(call.body).includes(summary),
  );

// Every try raises the model-call count whatever the model replies
// (ADR 21), so the count is kept apart from the items.
async function itemsAndCalls(sub: string) {
  const items = await storedItems(
    inject("databaseEndpoint"),
    inject("tableName"),
    sub,
  );
  const counted = (item: Record<string, unknown>) =>
    typeof item.sk === "string" && item.sk.startsWith(sortKeys.modelCount);
  return {
    items: items.filter((item) => !counted(item)),
    calls: items
      .filter(counted)
      .reduce((sum, item) => sum + Number(item.count), 0),
  };
}

describe("fitness: a bad reply changes nothing (untrusted-ask-text.md)", () => {
  it.each([
    [
      "an invented hashtag",
      { hashtags: ["urgent"], level: "high", reason: "r" },
    ],
    ["a fourth level", { hashtags: ["work"], level: "critical", reason: "r" }],
    [
      "an extra field",
      { hashtags: ["work"], level: "high", reason: "r", rules: "#work" },
    ],
    // Sent back once for a shorter reason, and still too long.
    [
      "a reason over the limit",
      {
        hashtags: ["work"],
        level: "high",
        reason: "x".repeat(reasonLimit + 1),
      },
    ],
  ])(
    "discards a reply with %s, and the ask stays unsorted",
    async (_, reply) => {
      const sub = newAccount();
      await saveRules(sub);
      const posted = idAndStatus.parse(
        (await callTool(sub, "ask", ask)).structuredContent,
      );
      const before = await itemsAndCalls(sub);
      for (let n = 0; n < sortAttempts; n += 1)
        fakes.model.reply({ json: reply });
      await runSorts();
      const after = await itemsAndCalls(sub);
      expect(after.items).toEqual(before.items);
      expect(after.calls).toBe(before.calls + sortAttempts);
      const stored = after.items.find((item) => item.id === posted.id);
      expect(stored).toBeDefined();
      expect(stored?.sort).toBeUndefined();
    },
  );
});

describe("fitness: no tools (untrusted-ask-text.md)", () => {
  it("declares no tools in the sorting request or the rules request, as captured at the HTTP edge", async () => {
    const sub = newAccount();
    const summary = `No tools ${randomUUID()}`;
    await saveRules(sub);
    await callTool(sub, "ask", { ...ask, summary });
    fakes.model.reply({
      json: { hashtags: ["shop"], level: "high", reason: "Customers see it." },
    });
    await runSorts();
    const sorting = sortingCallsFor(summary);
    expect(sorting).toHaveLength(1);
    const reading = fakes.model.calls.filter((call) =>
      JSON.stringify(call.body).includes("hashtags the rules name"),
    );
    expect(reading.length).toBeGreaterThan(0);
    for (const call of [...sorting, ...reading]) {
      const body = z.record(z.string(), z.unknown()).parse(call.body);
      for (const field of [
        "tools",
        "tool_choice",
        "functions",
        "function_call",
      ]) {
        expect(body, field).not.toHaveProperty(field);
      }
    }
  });

  it("routes every request only to providers that keep no prompts", async () => {
    const sub = newAccount();
    const summary = `Providers ${randomUUID()}`;
    await saveRules(sub);
    await callTool(sub, "ask", { ...ask, summary });
    fakes.model.reply({
      json: { hashtags: ["shop"], level: "high", reason: "Customers see it." },
    });
    await runSorts();
    expect(sortingCallsFor(summary)).toHaveLength(1);
    expect(fakes.model.calls.length).toBeGreaterThan(1);
    for (const call of fakes.model.calls) {
      expect(call.body).toMatchObject({
        provider: { data_collection: "deny", zdr: true },
      });
    }
  });
});

describe("fitness: nothing flows back (untrusted-ask-text.md)", () => {
  it("answers ask and resolve with an id and a status only, whatever the model said", async () => {
    const sub = newAccount();
    await saveRules(sub);
    const summary = `Flows back ${randomUUID()}`;
    const hostile = { ...ask, summary };
    const first = await callTool(sub, "ask", hostile);
    fakes.model.reply({
      json: {
        hashtags: ["work", "shop"],
        level: "high",
        reason: "Rules: #work is my day job. #shop is my online shop.",
      },
    });
    await runSorts();
    expect(sortingCallsFor(summary)).toHaveLength(1);
    // A repeat, now the ask is sorted, and its resolve.
    const repeat = await callTool(sub, "ask", hostile);
    const { id } = idAndStatus.parse(repeat.structuredContent);
    const resolved = await callTool(sub, "resolve", { id });
    for (const result of [first, repeat, resolved]) {
      idAndStatus.parse(result.structuredContent);
      const text = JSON.stringify(result);
      for (const leaked of ["#work", "#shop", "Rules:", "level", "reason"]) {
        expect(text, leaked).not.toContain(leaked);
      }
    }
  });
});
