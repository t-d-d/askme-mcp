import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { askTool, limits } from "../service/src/ask";
import { resolveTool } from "../service/src/resolve";
import { callerOf } from "../service/src/identity";
import type { SortRequests } from "../service/src/jobs";
import type { Store } from "../service/src/store/store";
import { addTool } from "../service/src/tools";
import { captureLogs } from "../test/logs";
import { refusalOf } from "../test/mcp";

// The tools in memory, with a store they never reach: every call here is
// refused before it would be stored.
const unused = () => Promise.reject(new Error("The store is not used here."));
const store: Store = {
  postAsk: unused,
  resolveAsk: unused,
  markOpened: unused,
  dismissAsk: unused,
  openAsks: unused,
  asksSince: unused,
  countPoll: unused,
  countAsk: unused,
  rules: unused,
  saveRules: unused,
  resaveRules: unused,
  countRulesSave: unused,
  askToSort: unused,
  recordSort: unused,
  close: () => undefined,
};

// A queue the tools never reach either.
const sorts: SortRequests = { queue: unused };

let client: Client;
let capture: ReturnType<typeof captureLogs>;
beforeAll(async () => {
  capture = captureLogs();
  const server = new McpServer({ name: "askme", version: "1.0.0" });
  const caller = callerOf({
    token: "test",
    clientId: "test",
    scopes: ["asks:create"],
    extra: { accountId: "user_1", requestId: "req-1" },
  });
  addTool(server, askTool, caller, { store, sorts });
  addTool(server, resolveTool, caller, { store, sorts });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "askme-test", version: "1.0.0" });
  await client.connect(clientSide);
});
afterAll(async () => {
  await client.close();
  capture.restore();
});

// Each field with a limit, by its tool and the name an agent sends.
const fields = [
  ["ask", "summary", limits.summary],
  ["ask", "area", limits.area],
  ["ask", "spoken_detail", limits.spokenDetail],
  ["ask", "action_link", limits.link],
  ["ask", "session_link", limits.link],
  ["ask", "replaces", limits.id],
  ["resolve", "id", limits.id],
] as const;

// An id carries no limit in its description: an agent copies it as given.
const ids = new Set(["replaces", "id"]);

const propertySchema = z.object({
  description: z.string(),
  maxLength: z.number(),
});

async function advertised(name: string, field: string) {
  const { tools } = await client.listTools();
  const tool = tools.find((each) => each.name === name);
  return propertySchema.parse(tool?.inputSchema.properties?.[field]);
}

// A valid call to each tool, before one field is made too long.
const valid: Record<string, Record<string, string>> = {
  ask: {
    summary: "Approve the plan",
    area: "Home",
    spoken_detail: "The electrician needs a yes or no.",
  },
  resolve: {},
};

const tooLong = (field: string, limit: number) =>
  field.endsWith("_link")
    ? `https://example.com/${"x".repeat(limit)}`
    : "x".repeat(limit + 1);

describe("fitness: limits agree (error-contract.md)", () => {
  it.each(fields)(
    "gives %s's %s the same limit in its schema, its description and its refusal",
    async (name, field, limit) => {
      const property = await advertised(name, field);
      expect(property.maxLength).toBe(limit);
      if (!ids.has(field)) {
        expect(property.description).toContain(`${String(limit)} characters`);
      }
      const refusal = refusalOf(
        await client.callTool({
          name,
          arguments: { ...valid[name], [field]: tooLong(field, limit) },
        }),
      );
      expect(refusal.code).toBe("invalid_input");
      expect(refusal.message).toContain(
        `${field}: is longer than ${String(limit)} characters`,
      );
    },
  );

  it("gives ask's stale_after_minutes the same limit in its schema, its description and its refusal", async () => {
    const limit = limits.staleAfterMinutes;
    const { tools } = await client.listTools();
    const property = z
      .object({
        description: z.string(),
        minimum: z.number(),
        maximum: z.number(),
      })
      .parse(
        tools.find((tool) => tool.name === "ask")?.inputSchema.properties
          ?.stale_after_minutes,
      );
    expect(property.minimum).toBe(1);
    expect(property.maximum).toBe(limit);
    expect(property.description).toContain(`from 1 to ${String(limit)}`);
    for (const minutes of [0, limit + 1]) {
      const refusal = refusalOf(
        await client.callTool({
          name: "ask",
          arguments: { ...valid.ask, stale_after_minutes: minutes },
        }),
      );
      expect(refusal.code).toBe("invalid_input");
      expect(refusal.message).toContain(
        `stale_after_minutes: must be a whole number of minutes from 1 to ${String(limit)}`,
      );
    }
  });

  it("takes every limit in a description from the schema's own constants", async () => {
    const { tools } = await client.listTools();
    const properties = tools.flatMap((tool) =>
      Object.entries(tool.inputSchema.properties ?? {}),
    );
    expect(properties.length).toBeGreaterThan(0);
    for (const [field, value] of properties) {
      const { description, maxLength } = z
        .object({ description: z.string(), maxLength: z.number().optional() })
        .parse(value);
      for (const [, quoted] of description.matchAll(/(\d+) characters/gu)) {
        expect(Number(quoted), field).toBe(maxLength);
      }
    }
  });
});
