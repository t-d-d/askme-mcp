import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const phone = { width: 390, height: 844 };
const desktop = { width: 1280, height: 800 };

describe("live: the page loads", () => {
  it.each([
    ["a phone", phone],
    ["a desktop", desktop],
  ])("serves the signed-out page on %s", async (_, viewport) => {
    const url = z.url({ protocol: /^https$/u }).parse(process.env.ASKME_URL, {
      error: () => "Set ASKME_URL to the live address.",
    });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport });
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
