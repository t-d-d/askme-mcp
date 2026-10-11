import { describe, expect, it } from "vitest";
import { z } from "zod";
import { pagePaths } from "../shared/page-api";

describe("live: the API answers a signed-out call with a 401", () => {
  // The page calls its API on its own address, which the distribution sends
  // on to the service.
  const pageUrl = () =>
    z.url({ protocol: /^https$/u }).parse(process.env.ASKME_URL, {
      error: () => "Set ASKME_URL to the live address.",
    });

  it.each(Object.values(pagePaths))(
    "refuses %s with no token",
    async (path) => {
      const response = await fetch(new URL(path, pageUrl()));
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
    },
  );
});
