import { describe, expect, it } from "vitest";
import { incoming, result } from "./http";

// An event in the shape API Gateway's HTTP API sends, payload version 2.0.
const event = (overrides: Record<string, unknown> = {}) => ({
  version: "2.0",
  routeKey: "POST /mcp",
  rawPath: "/mcp",
  rawQueryString: "",
  headers: { "content-type": "application/json" },
  body: "{}",
  isBase64Encoded: false,
  requestContext: {
    requestId: "JKJaXmPLvHcESHA=",
    domainName: "abc123.execute-api.us-east-1.amazonaws.com",
    http: { method: "POST" },
  },
  ...overrides,
});

describe("the HTTP boundary", () => {
  it("reads API Gateway's event, request id included", async () => {
    const parsed = incoming(event());
    expect(parsed?.route).toBe("POST /mcp");
    expect(parsed?.requestId).toBe("JKJaXmPLvHcESHA=");
    expect(parsed?.origin).toBe(
      "https://abc123.execute-api.us-east-1.amazonaws.com",
    );
    expect(parsed?.request.url).toBe(
      "https://abc123.execute-api.us-east-1.amazonaws.com/mcp",
    );
    expect(await parsed?.request.text()).toBe("{}");
  });

  it("decodes a body API Gateway sent as base64", async () => {
    const parsed = incoming(
      event({
        body: Buffer.from('{"a":1}').toString("base64"),
        isBase64Encoded: true,
      }),
    );
    expect(await parsed?.request.text()).toBe('{"a":1}');
  });

  it("keeps the query string", () => {
    expect(incoming(event({ rawQueryString: "a=1&b=2" }))?.request.url).toBe(
      "https://abc123.execute-api.us-east-1.amazonaws.com/mcp?a=1&b=2",
    );
  });

  it("reads nothing from an event that is not API Gateway's", () => {
    expect(incoming({ hello: "world" })).toBeUndefined();
    expect(
      incoming(
        event({
          requestContext: {
            requestId: "x",
            domainName: "evil.example/path",
            http: { method: "POST" },
          },
        }),
      ),
    ).toBeUndefined();
  });

  it("gives API Gateway the response's status, headers and body", async () => {
    expect(
      await result(
        Response.json({ ok: true }, { status: 201, headers: { "x-a": "b" } }),
      ),
    ).toEqual({
      statusCode: 201,
      headers: { "content-type": "application/json", "x-a": "b" },
      body: '{"ok":true}',
      isBase64Encoded: false,
    });
  });
});
