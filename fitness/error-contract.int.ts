import { createServer, type AddressInfo } from "node:net";
import { once } from "node:events";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { handler } from "../service/src/handler";
import { pagePaths } from "../shared/page-api";
import { captureLogs, lineText } from "../test/logs";
import { startFakeIssuer, type FakeIssuer } from "../test/identity";
import { invoke } from "../test/lambda";
import { connect, mcpUrl, origin, refusalOf } from "../test/mcp";

async function closedPort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = portOf(server.address());
  server.close();
  await once(server, "close");
  return port;
}

function portOf(address: string | AddressInfo | null): AddressInfo {
  if (address === null || typeof address === "string") {
    throw new Error("The server has no port.");
  }
  return address;
}

let issuer: FakeIssuer;
let capture: ReturnType<typeof captureLogs>;
beforeAll(async () => {
  issuer = await startFakeIssuer();
  vi.stubEnv("CLERK_ISSUER", issuer.issuer);
  // The store cannot be reached, which the service does not expect.
  vi.stubEnv(
    "DYNAMODB_ENDPOINT",
    `http://127.0.0.1:${String(await closedPort())}`,
  );
  capture = captureLogs();
});
afterAll(async () => {
  capture.restore();
  vi.unstubAllEnvs();
  await issuer.close();
});

// A stack frame, a socket error, or the address the store was at.
const internal = /\bat \S+ \(|ECONNREFUSED|127\.0\.0\.1|Error:/u;

describe("fitness: unknown failures are contained (error-contract.md)", () => {
  // Must run first, while no key has been fetched.
  it("answers an MCP call with service_unavailable when the identity service is down, saying nothing internal", async () => {
    issuer.failing = true;
    try {
      const response = await invoke(
        handler,
        new Request(mcpUrl, {
          method: "POST",
          headers: { authorization: `Bearer ${await issuer.token()}` },
        }),
      );
      expect(response.status).toBe(503);
      const text = await response.text();
      const refusal = z
        .strictObject({
          code: z.string(),
          class: z.string(),
          message: z.string(),
        })
        .parse(JSON.parse(text));
      expect(refusal.code).toBe("service_unavailable");
      expect(refusal.class).toBe("retry");
      expect(text).not.toMatch(internal);
    } finally {
      issuer.failing = false;
    }
  });

  it("answers ask with service_unavailable, saying nothing internal", async () => {
    const client = await connect(handler, { token: await issuer.token() });
    try {
      const result = await client.callTool({
        name: "ask",
        arguments: {
          summary: "Approve the plan",
          area: "Home",
          spoken_detail: "The electrician needs a yes or no.",
        },
      });
      const refusal = refusalOf(result);
      expect(refusal.code).toBe("service_unavailable");
      expect(refusal.class).toBe("retry");
      expect(JSON.stringify(result)).not.toMatch(internal);
    } finally {
      await client.close();
    }
  }, 15_000);

  it("answers resolve with service_unavailable, saying nothing internal", async () => {
    const client = await connect(handler, { token: await issuer.token() });
    try {
      const result = await client.callTool({
        name: "resolve",
        arguments: { id: "AAAAAAAAAAAAAAAAAAAAAAAA" },
      });
      const refusal = refusalOf(result);
      expect(refusal.code).toBe("service_unavailable");
      expect(refusal.class).toBe("retry");
      expect(JSON.stringify(result)).not.toMatch(internal);
    } finally {
      await client.close();
    }
  }, 15_000);

  it("answers the page's list with service_unavailable, saying nothing internal", async () => {
    const response = await invoke(
      handler,
      new Request(`${origin}${pagePaths.asks}`, {
        headers: {
          authorization: `Bearer ${await issuer.sessionToken()}`,
        },
      }),
    );
    expect(response.status).toBe(503);
    const text = await response.text();
    const refusal = z
      .strictObject({
        code: z.string(),
        class: z.string(),
        message: z.string(),
      })
      .parse(JSON.parse(text));
    expect(refusal.code).toBe("service_unavailable");
    expect(refusal.class).toBe("retry");
    expect(text).not.toMatch(internal);
  }, 15_000);

  it("logs each failure at error, by its class", () => {
    const failures = capture.lines.filter(
      (line) =>
        line.method === "error" && lineText(line).includes("request-failed"),
    );
    expect(failures.length).toBeGreaterThanOrEqual(3);
  });
});
