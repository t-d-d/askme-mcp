import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { askTool } from "../service/src/ask";
import { handler } from "../service/src/handler";
import { events } from "../service/src/log";
import { startFakeIssuer, type FakeIssuer } from "../test/identity";
import { invoke } from "../test/lambda";
import { captureLogs, lineText } from "../test/logs";
import { connect, eras, mcpUrl, refusalOf } from "../test/mcp";

// A string no code would write by itself. It goes into every field an agent
// writes, and into tokens, and must never reach a log line.
const marker = "Zq7MarkerXv";

const ask = {
  summary: `Summary ${marker}`,
  area: `Area ${marker}`,
  spoken_detail: `Spoken detail ${marker}`,
  action_link: `https://${marker}.example.com/action`,
  session_link: `https://${marker}.example.com/session`,
  replaces: `ask-${marker}`,
};

let issuer: FakeIssuer;
let capture: ReturnType<typeof captureLogs>;
const tokens: string[] = [];
const token = async (...args: Parameters<FakeIssuer["token"]>) => {
  const value = await issuer.token(...args);
  tokens.push(value);
  return value;
};

beforeAll(async () => {
  issuer = await startFakeIssuer();
  vi.stubEnv("CLERK_ISSUER", issuer.issuer);
  capture = captureLogs();
});
afterAll(async () => {
  capture.restore();
  vi.unstubAllEnvs();
  await issuer.close();
});

describe("fitness: no content reaches the output (logging.md)", () => {
  // First, while no key has been fetched: the service cannot reach Clerk.
  it("runs the path where the identity service is down", async () => {
    issuer.failing = true;
    try {
      const response = await invoke(
        handler,
        new Request(mcpUrl, {
          method: "POST",
          headers: { authorization: `Bearer ${await token()}` },
          body: JSON.stringify(ask),
        }),
      );
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(marker);
    } finally {
      issuer.failing = false;
    }
  });

  it("runs the paths that refuse a token", async () => {
    await expect(connect(handler)).rejects.toThrow();
    await expect(
      connect(handler, { token: `not-a-token-${marker}` }),
    ).rejects.toThrow();
    tokens.push(`not-a-token-${marker}`);
    await expect(
      connect(handler, { token: await token({ foreignKey: true }) }),
    ).rejects.toThrow();
    await expect(
      connect(handler, {
        token: await token({ claims: { sub: `user_${marker}` }, typ: "JWT" }),
      }),
    ).rejects.toThrow();
  });

  it("runs the path that refuses a token without the scope", async () => {
    const client = await connect(handler, {
      token: await token({ claims: { scope: "openid" } }),
    });
    const refusal = refusalOf(
      await client.callTool({ name: "ask", arguments: ask }),
    );
    expect(refusal.code).toBe("insufficient_scope");
    await client.close();
  });

  it("runs the path that refuses bad input", async () => {
    const client = await connect(handler, { token: await token() });
    const refusal = refusalOf(
      await client.callTool({
        name: "ask",
        arguments: { ...ask, action_link: `http://${marker}.example.com` },
      }),
    );
    expect(refusal.code).toBe("invalid_input");
    await client.close();
  });

  it.each(eras)(
    "runs the path that posts an ask, %s handshake",
    async (era) => {
      const client = await connect(handler, { token: await token(), era });
      const result = await client.callTool({ name: "ask", arguments: ask });
      expect(result.isError).not.toBe(true);
      await client.close();
    },
  );

  it("runs the path where the tool fails unexpectedly", async () => {
    const run = vi
      .spyOn(askTool, "run")
      .mockRejectedValueOnce(new Error(`Lost the ask ${marker}`));
    try {
      const client = await connect(handler, { token: await token() });
      const result = await client.callTool({ name: "ask", arguments: ask });
      const refusal = refusalOf(result);
      expect(refusal.code).toBe("service_unavailable");
      expect(refusal.class).toBe("retry");
      expect(JSON.stringify(result)).not.toContain("Lost the ask");
      await client.close();
    } finally {
      run.mockRestore();
    }
  });

  it("wrote lines on those paths", () => {
    const written = new Set(
      capture.lines.map((line) => JSON.stringify(line.args[0] ?? {})),
    );
    for (const event of [
      "token-missing",
      "token-rejected",
      "scope-missing",
      "input-invalid",
      "ask-posted",
      "request-failed",
    ]) {
      expect(
        [...written].some((line) => line.includes(`"event":"${event}"`)),
        event,
      ).toBe(true);
    }
  });

  it("finds no marker and no token in any line", () => {
    for (const line of capture.lines) {
      const text = lineText(line);
      expect(text).not.toContain(marker);
      for (const value of tokens) expect(text).not.toContain(value);
    }
  });

  it("finds that every line came from the shared logger, with an event and the request id", () => {
    const fromLogger = z.object({
      event: z.enum(events),
      requestId: z.string().regex(/^[\w-]+$/u),
    });
    for (const line of capture.lines) {
      expect(["info", "warn", "error"], lineText(line)).toContain(line.method);
      expect(line.args, lineText(line)).toHaveLength(1);
      expect(fromLogger.safeParse(line.args[0]).success, lineText(line)).toBe(
        true,
      );
    }
  });
});
