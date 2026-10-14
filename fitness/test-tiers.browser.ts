import { describe, expect, inject, it } from "vitest";
import { openPage } from "../test/browser";

describe("fitness: the gate is offline (test-tiers.md)", () => {
  it("refuses a request from the browser to another host", async () => {
    // The page's CSP would refuse the fetch before the guard sees it
    // (ADR 28).
    const open = await openPage(
      inject("pageUrl"),
      { width: 390, height: 844 },
      { csp: false },
    );
    try {
      const failed = await open.page.evaluate(() =>
        fetch("https://example.com/").then(
          () => false,
          () => true,
        ),
      );
      expect(failed).toBe(true);
      expect(open.refused).toContain("https://example.com/");
    } finally {
      await open.close();
    }
  });
});
