import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { pageUrl, phone } from "../test/live";

const desktop = { width: 1280, height: 800 };

describe("live: the page loads", () => {
  it.each([
    ["a phone", phone],
    ["a desktop", desktop],
  ])("serves the signed-out page on %s", async (_, viewport) => {
    const url = pageUrl();
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
      // The page shows these only once Clerk has said nobody is signed in.
      expect(
        await page.getByRole("button", { name: "Sign up" }).isVisible(),
      ).toBe(true);
      expect(
        await page.getByRole("button", { name: "Sign in" }).isVisible(),
      ).toBe(true);
    } finally {
      await browser.close();
    }
  });
});
