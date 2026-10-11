import { getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { clerkIssuer, mcpUrl } from "../test/live";

describe("live: the MCP endpoint gives its 401 and its metadata", () => {
  const metadataUrl = () =>
    getOAuthProtectedResourceMetadataUrl(new URL(mcpUrl()));

  it("answers a call with no token with a 401 that points to the metadata", async () => {
    const response = await fetch(mcpUrl(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: "{}",
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      `resource_metadata="${metadataUrl()}"`,
    );
  });

  it("serves metadata that names Clerk", async () => {
    const response = await fetch(metadataUrl());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      resource: mcpUrl(),
      authorization_servers: [clerkIssuer().replace(/\/$/u, "")],
      scopes_supported: ["asks:create"],
    });
  });
});
