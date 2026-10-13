import { describe, expect, it } from "vitest";
import { pagePaths } from "../shared/page-api";
import { pageUrl } from "../test/live";

describe("live: the API answers a signed-out call with a 401", () => {
  // The distribution sends the page's own /api/ address on to the service.
  it.each(Object.values(pagePaths))(
    "refuses %s with no token",
    async (path) => {
      const response = await fetch(new URL(path, pageUrl()));
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
    },
  );
});

describe("live: the API's answers carry the service's clock", () => {
  // web/src/load.ts reads the clock from a refusal's Date header. The live
  // tier cannot spend a cap without writes, so it reads a 401's instead.
  it("gives the time in a Date header, within a minute of this clock", async () => {
    const response = await fetch(new URL(pagePaths.asks, pageUrl()));
    const date = Date.parse(response.headers.get("date") ?? "");
    expect(Math.abs(date - Date.now())).toBeLessThan(60_000);
  });
});
