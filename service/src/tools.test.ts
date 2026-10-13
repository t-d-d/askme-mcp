import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { captureLogs, lineText } from "../../test/logs";
import { refusalOf } from "../../test/mcp";
import { callerOf } from "./identity";
import type { SortRequests } from "./jobs";
import type { Store } from "./store/store";
import { addTool, type ToolDefinition } from "./tools";

let capture: ReturnType<typeof captureLogs>;
beforeEach(() => {
  capture = captureLogs();
});
afterEach(() => {
  capture.restore();
});

const input = z.strictObject({});
const output = z.object({ id: z.string().min(3) });

// A store this tool never reaches.
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
  countModelCall: unused,
  modelCapSpent: unused,
  recordModelCapReset: unused,
  askToSort: unused,
  recordSort: unused,
  close: () => undefined,
};

// A queue this tool never reaches.
const sorts: SortRequests = { queue: unused };

// A tool whose answer passes its type but not its schema, as a bug in a
// later store read might give.
const brokenTool: ToolDefinition<typeof input, typeof output> = {
  name: "broken",
  description: "Answers with an id its own schema refuses.",
  input,
  output,
  run: () => Promise.resolve({ id: "x" }),
};

describe("a tool whose answer breaks its own schema", () => {
  it("is refused as service_unavailable, and logged as a failure", async () => {
    const server = new McpServer({ name: "askme", version: "1.0.0" });
    addTool(
      server,
      brokenTool,
      callerOf({
        token: "test",
        clientId: "test",
        scopes: ["asks:create"],
        extra: { accountId: "user_1", requestId: "req-1" },
      }),
      { store, sorts },
    );
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "askme-test", version: "1.0.0" });
    await client.connect(clientSide);

    const refusal = refusalOf(
      await client.callTool({ name: "broken", arguments: {} }),
    );
    expect(refusal.code).toBe("service_unavailable");
    expect(refusal.class).toBe("retry");
    expect(
      capture.lines.some((line) => lineText(line).includes("request-failed")),
    ).toBe(true);
    await client.close();
    await server.close();
  });
});

describe("a tool called without the asks:create scope", () => {
  it("is refused in words that fit resolve as well as ask", async () => {
    const server = new McpServer({ name: "askme", version: "1.0.0" });
    addTool(
      server,
      brokenTool,
      callerOf({
        token: "test",
        clientId: "test",
        scopes: [],
        extra: { accountId: "user_1", requestId: "req-1" },
      }),
      { store, sorts },
    );
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "askme-test", version: "1.0.0" });
    await client.connect(clientSide);

    const refusal = refusalOf(
      await client.callTool({ name: "broken", arguments: {} }),
    );
    expect(refusal.code).toBe("insufficient_scope");
    expect(refusal.message).toContain("not allowed to post or resolve asks");
    await client.close();
    await server.close();
  });
});
