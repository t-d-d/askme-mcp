import { describe, expect, it } from "vitest";
import { z } from "zod";

const https = z.url({ protocol: /^https$/u });

describe("live: the MCP endpoint gives its 401 and its metadata", () => {
  const mcpUrl = () =>
    https.parse(process.env.ASKME_MCP_URL, {
      error: () => "Set ASKME_MCP_URL to the live MCP endpoint.",
    });
  const clerkIssuer = () =>
    https.parse(process.env.CLERK_ISSUER, {
      error: () => "Set CLERK_ISSUER to the Clerk issuer the service uses.",
    });

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
    const metadataUrl = new URL(mcpUrl());
    metadataUrl.pathname = `/.well-known/oauth-protected-resource${metadataUrl.pathname}`;
    expect(response.headers.get("www-authenticate")).toContain(
      `resource_metadata="${metadataUrl.href}"`,
    );
  });

  it("serves metadata that names Clerk", async () => {
    const metadataUrl = new URL(mcpUrl());
    metadataUrl.pathname = `/.well-known/oauth-protected-resource${metadataUrl.pathname}`;
    const response = await fetch(metadataUrl);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      resource: mcpUrl(),
      authorization_servers: [clerkIssuer().replace(/\/$/u, "")],
      scopes_supported: ["asks:create"],
    });
  });
});
