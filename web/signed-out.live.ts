import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("live: the page loads", () => {
  it("serves the signed-out page at the live address", async () => {
    const url = z.url({ protocol: /^https$/u }).parse(process.env.ASKME_URL, {
      error: () => "Set ASKME_URL to the live address.",
    });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
      });
      const response = await page.goto(url);
      expect(response?.status()).toBe(200);
      expect(await page.getByRole("heading", { level: 1 }).innerText()).toBe(
        "Your agents ask here. You decide what gets through.",
      );
      expect(
        await page
          .getByText("This is a demo. Every ask is deleted")
          .isVisible(),
      ).toBe(true);
    } finally {
      await browser.close();
    }
  });
});
