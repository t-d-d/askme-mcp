import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { askTool } from "../service/src/ask";
import { handler } from "../service/src/handler";
import { events } from "../service/src/log";
import { handler as sorter, sortDeliveries } from "../service/src/sorter";
import { askChangePaths, pagePaths } from "../shared/page-api";
import { newAccount } from "../test/caller";
import { fakes } from "../test/fakes";
import { useFakeIssuer, type FakeIssuer } from "../test/identity";
import { invoke } from "../test/lambda";
import { captureLogs, lineText } from "../test/logs";
import { connect, eras, mcpUrl, origin, refusalOf } from "../test/mcp";

// Goes into every field an agent writes and into tokens, and must never
// reach a log line.
const marker = "Zq7MarkerXv";

const ask = {
  summary: `Summary ${marker}`,
  area: `Area ${marker}`,
  spoken_detail: `Spoken detail ${marker}`,
  action_link: `https://${marker}.example.com/action`,
  session_link: `https://${marker}.example.com/session`,
  replaces: `ask-${marker}`,
};

const issuer = useFakeIssuer();
let capture: ReturnType<typeof captureLogs>;
const tokens: string[] = [];
const token = async (...args: Parameters<FakeIssuer["token"]>) => {
  const value = await issuer.token(...args);
  tokens.push(value);
  return value;
};

beforeAll(() => {
  capture = captureLogs();
});
afterAll(() => {
  capture.restore();
});

describe("fitness: no content reaches the output (logging.md)", () => {
  // Must run first, while no key has been fetched.
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

  it("runs the paths of the page's API", async () => {
    const call = (token?: string) =>
      invoke(
        handler,
        new Request(`${origin}${pagePaths.asks}?note=${marker}`, {
          headers:
            token === undefined ? {} : { authorization: `Bearer ${token}` },
        }),
      );
    expect((await call()).status).toBe(401);
    tokens.push(`not-a-token-${marker}`);
    expect((await call(`not-a-token-${marker}`)).status).toBe(401);
    expect((await call(await token())).status).toBe(403);
    const session = await issuer.sessionToken();
    tokens.push(session);
    const response = await call(session);
    expect(response.status).toBe(200);
    // The page's list holds what the agent wrote, and the log does not.
    expect(await response.text()).toContain(marker);
  });

  it("runs the paths that save the rules and sort an ask", async () => {
    // An account of its own, so its rules reach no other test file.
    const sub = newAccount();
    const agent = await connect(handler, {
      token: await token({ claims: { sub } }),
    });
    for (const summary of [`First ${marker}`, `Second ${marker}`]) {
      await agent.callTool({ name: "ask", arguments: { ...ask, summary } });
    }
    await agent.close();
    const session = await issuer.sessionToken({ claims: { sub } });
    tokens.push(session);
    const save = (text: string) =>
      invoke(
        handler,
        new Request(`${origin}${pagePaths.rules}`, {
          method: "PUT",
          headers: {
            authorization: `Bearer ${session}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ text }),
        }),
      );
    // Rules the model reads, then rules it cannot, then those read, then
    // saved again unchanged.
    fakes.model.reply({ json: { hashtags: ["work"], hours: [] } });
    expect((await save(`#work is ${marker}`)).status).toBe(200);
    fakes.model.reply({ status: 502 });
    expect((await save(`#work and #home are ${marker}`)).status).toBe(200);
    fakes.model.reply({ json: { hashtags: ["work", "home"], hours: [] } });
    expect((await save(`#work and #home are ${marker}`)).status).toBe(200);
    expect((await save(`#work and #home are ${marker}`)).status).toBe(200);
    // The first ask sorted with a reply that holds the marker, and the
    // second failed by the model on every delivery, until it is let go.
    fakes.model.reply({
      json: { hashtags: ["work"], level: "high", reason: `For ${marker}` },
    });
    for (let delivery = 0; delivery < sortDeliveries; delivery++) {
      await fakes.queue.deliver((event) =>
        sorter(event, { awsRequestId: "sort-1" }),
      );
    }
  });

  it("runs the paths that open and dismiss an ask from the page", async () => {
    const sub = newAccount();
    const agent = await connect(handler, {
      token: await token({ claims: { sub } }),
    });
    const { id } = z
      .object({ id: z.string() })
      .parse(
        (await agent.callTool({ name: "ask", arguments: ask }))
          .structuredContent,
      );
    await agent.close();
    const session = await issuer.sessionToken({ claims: { sub } });
    tokens.push(session);
    const change = (path: string, body: string) =>
      invoke(
        handler,
        new Request(`${origin}${path}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${session}`,
            "content-type": "application/json",
          },
          body,
        }),
      );
    const { opened, dismissed } = askChangePaths;
    expect((await change(opened, JSON.stringify({ id }))).status).toBe(204);
    expect((await change(dismissed, JSON.stringify({ id }))).status).toBe(204);
    expect((await change(opened, JSON.stringify({ id: marker }))).status).toBe(
      404,
    );
    expect(
      (await change(dismissed, JSON.stringify({ id: `a/${marker}` }))).status,
    ).toBe(400);
    expect((await change(dismissed, marker)).status).toBe(400);
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
      "agent-token-refused",
      "request-failed",
      "rules-saved",
      "rules-read-failed",
      "rules-resaved",
      "ask-sorted",
      "sort-retried",
      "sort-failed",
      "ask-opened",
      "ask-dismissed",
      "ask-not-found",
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
