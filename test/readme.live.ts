// The README gives the deployed site's addresses, so a reader can open the
// page or connect an agent without opening a deploy run (#316). A deploy
// that changes either address fails here until the README gives the new one.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mcpUrl, pageUrl } from "./live";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("live: the README gives the deployed addresses", () => {
  it.each([
    ["the page's address", pageUrl],
    ["the MCP endpoint", mcpUrl],
  ])("gives %s", (_, address) => {
    const url = address();
    expect(readme.includes(url), `The README does not give ${url}`).toBe(true);
  });
});
