// ADR 12's checks on the whole sorting path, in process: the page's API and
// the MCP endpoint on the local DynamoDB, the sort function run as Lambda
// would run it, and the model faked at the HTTP edge.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { z } from "zod";
import { handler } from "../service/src/handler";
import { handler as sorter, sortAttempts } from "../service/src/sorter";
import { pagePaths } from "../shared/page-api";
import { storedItems } from "../test/dynamodb";
import { fakes, type ModelCall } from "../test/fakes";
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
  fakes.model.reply({ json: { hashtags: ["work", "shop"] } });
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

// Exactly what the ask tool and the resolve tool may answer (ADR 2).
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

const runSorts = () =>
  fakes.lambda.drain((payload) => sorter(payload, { awsRequestId: "sort-1" }));

// The sorting calls the model received for one ask, found by its summary.
const sortingCallsFor = (summary: string): ModelCall[] =>
  fakes.model.calls.filter((call) =>
    JSON.stringify(call.body).includes(summary),
  );

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
  ])(
    "discards a reply with %s, and the ask stays unsorted",
    async (_, reply) => {
      const sub = newAccount();
      await saveRules(sub);
      await runSorts();
      const posted = idAndStatus.parse(
        (await callTool(sub, "ask", ask)).structuredContent,
      );
      const before = await storedItems(
        inject("databaseEndpoint"),
        inject("tableName"),
        sub,
      );
      for (let n = 0; n < sortAttempts; n += 1)
        fakes.model.reply({ json: reply });
      await runSorts();
      const after = await storedItems(
        inject("databaseEndpoint"),
        inject("tableName"),
        sub,
      );
      expect(after).toEqual(before);
      const stored = after.find((item) => item.id === posted.id);
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

  it("routes every request only to providers that keep no prompts", () => {
    expect(fakes.model.calls.length).toBeGreaterThan(0);
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
    await runSorts();
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
