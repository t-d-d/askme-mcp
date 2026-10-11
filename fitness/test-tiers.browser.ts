import { describe, expect, inject, it } from "vitest";
import { openPage } from "../test/browser";

describe("fitness: the gate is offline (test-tiers.md)", () => {
  it("refuses a request from the browser to another host", async () => {
    const open = await openPage(inject("pageUrl"), { width: 390, height: 844 });
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
