import { describe, expect, it } from "vitest";
import { pagePaths } from "../shared/page-api";
import { pageUrl } from "../test/live";

describe("live: the API answers a signed-out call with a 401", () => {
  // The page calls its API on its own address, which the distribution sends
  // on to the service.
  it.each(Object.values(pagePaths))(
    "refuses %s with no token",
    async (path) => {
      const response = await fetch(new URL(path, pageUrl()));
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
    },
  );
});
