import { describe, expect, it } from "vitest";
import { cursorInstallLink } from "./cursor";

describe("the link that adds askme to Cursor", () => {
  const mcpUrl = "https://abc123.execute-api.us-east-1.amazonaws.com/mcp";

  it("opens Cursor's install page, naming the server askme", () => {
    const link = new URL(cursorInstallLink(mcpUrl));
    expect(link.origin).toBe("https://cursor.com");
    expect(link.pathname).toBe("/en/install-mcp");
    expect(link.searchParams.get("name")).toBe("askme");
  });

  it("carries the server address as base64 JSON, as Cursor reads it", () => {
    const config = new URL(cursorInstallLink(mcpUrl)).searchParams.get(
      "config",
    );
    expect(JSON.parse(atob(config ?? ""))).toEqual({ url: mcpUrl });
  });
});
