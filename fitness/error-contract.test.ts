import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { askTool, limits } from "../service/src/ask";
import { callerOf } from "../service/src/identity";
import type { Store } from "../service/src/store/store";
import { addTool } from "../service/src/tools";
import { captureLogs } from "../test/logs";
import { refusalOf } from "../test/mcp";

// The ask tool in memory, with a store it never reaches: every call here is
// refused before it would be stored.
const unused = () => Promise.reject(new Error("The store is not used here."));
const store: Store = {
  postAsk: unused,
  openAsks: unused,
  asksSince: unused,
  countPoll: unused,
  close: () => undefined,
};

let client: Client;
let capture: ReturnType<typeof captureLogs>;
beforeAll(async () => {
  capture = captureLogs();
  const server = new McpServer({ name: "askme", version: "1.0.0" });
  addTool(
    server,
    askTool,
    callerOf({
      token: "test",
      clientId: "test",
      scopes: ["asks:create"],
      extra: { accountId: "user_1", requestId: "req-1" },
    }),
    store,
  );
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "askme-test", version: "1.0.0" });
  await client.connect(clientSide);
});
afterAll(async () => {
  await client.close();
  capture.restore();
});

// Each field with a limit, by the name an agent sends.
const fields = {
  summary: limits.summary,
  area: limits.area,
  spoken_detail: limits.spokenDetail,
  action_link: limits.link,
  session_link: limits.link,
  replaces: limits.replaces,
} as const;

const propertySchema = z.object({
  description: z.string(),
  maxLength: z.number(),
});

async function advertised(field: string) {
  const { tools } = await client.listTools();
  const ask = tools.find((tool) => tool.name === "ask");
  return propertySchema.parse(ask?.inputSchema.properties?.[field]);
}

const valid = {
  summary: "Approve the plan",
  area: "Home",
  spoken_detail: "The electrician needs a yes or no.",
};

const tooLong = (field: string, limit: number) =>
  field.endsWith("_link")
    ? `https://example.com/${"x".repeat(limit)}`
    : "x".repeat(limit + 1);

describe("fitness: limits agree (error-contract.md)", () => {
  it.each(Object.entries(fields))(
    "gives %s the same limit in its schema, its description and its refusal",
    async (field, limit) => {
      const property = await advertised(field);
      expect(property.maxLength).toBe(limit);
      if (field !== "replaces") {
        expect(property.description).toContain(`${String(limit)} characters`);
      }
      const refusal = refusalOf(
        await client.callTool({
          name: "ask",
          arguments: { ...valid, [field]: tooLong(field, limit) },
        }),
      );
      expect(refusal.code).toBe("invalid_input");
      expect(refusal.message).toContain(
        `${field}: is longer than ${String(limit)} characters`,
      );
    },
  );

  it("takes every limit in a description from the schema's own constants", async () => {
    const { tools } = await client.listTools();
    const properties = tools.find((tool) => tool.name === "ask")?.inputSchema
      .properties;
    for (const [field, value] of Object.entries(properties ?? {})) {
      const { description, maxLength } = z
        .object({ description: z.string(), maxLength: z.number().optional() })
        .parse(value);
      for (const [, quoted] of description.matchAll(/(\d+) characters/gu)) {
        expect(Number(quoted), field).toBe(maxLength);
      }
    }
  });
});
