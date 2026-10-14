import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { builtFiles, openPage, type OpenPage } from "../test/browser";

const phone = { width: 390, height: 844 };
const desktop = { width: 1280, height: 800 };

const headline = "Your agents ask here. You decide what gets through.";
const about =
  "One place where all your AI agents ask for your input, sorted by rules you write in plain English.";
const notice =
  "This is a demo. Every ask is deleted after a month, and sign-ups stop at 100 accounts.";

describe.each([
  ["a phone", phone],
  ["a desktop", desktop],
])("the signed-out page on %s", (_, viewport) => {
  let open: OpenPage;
  beforeAll(async () => {
    open = await openPage(inject("pageUrl"), viewport);
  });
  afterAll(async () => {
    await open.close();
  });

  it("says what askme is", async () => {
    const { page } = open;
    expect(await page.title()).toBe("askme");
    expect(await page.getByRole("heading", { level: 1 }).innerText()).toBe(
      headline,
    );
    expect(await page.getByText(about).isVisible()).toBe(true);
  });

  it("carries the demo notice", async () => {
    expect(await open.page.getByText(notice).isVisible()).toBe(true);
  });

  it("offers Sign up, and Sign in for someone who has an account", async () => {
    const { page } = open;
    const buttons = await page.getByRole("button").allInnerTexts();
    expect(buttons.sort()).toEqual(["Sign in", "Sign up"]);
    expect(await page.getByRole("link").count()).toBe(0);
  });

  it("sends the person to Clerk's own sign-up screen", async () => {
    await open.page.getByRole("button", { name: "Sign up" }).click();
    expect(await open.askedFor()).toBe("sign-up");
  });

  it("sends the person to Clerk's own sign-in screen", async () => {
    await open.page.getByRole("button", { name: "Sign in" }).click();
    expect(await open.askedFor()).toBe("sign-in");
  });

  it("makes each button big enough to tap", async () => {
    for (const button of await open.page.getByRole("button").all()) {
      const box = await button.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  });

  it("asks the page's API for nothing", () => {
    expect(open.apiCalls).toEqual([]);
  });

  it("scrolls only up and down", async () => {
    const width = await open.page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(width).toBeLessThanOrEqual(viewport.width);
  });

  it("sets its text in the bundled font", async () => {
    const loaded = await open.page.evaluate(() =>
      [...document.fonts].some(
        (face) =>
          face.family.includes("Bricolage Grotesque") &&
          face.status === "loaded",
      ),
    );
    expect(loaded).toBe(true);
  });
});

describe("fitness: no outside requests for style (styling.md)", () => {
  let open: OpenPage;
  beforeAll(async () => {
    // The page's CSP would refuse an outside request before the guard
    // records it (ADR 28).
    open = await openPage(inject("pageUrl"), phone, { csp: false });
  });
  afterAll(async () => {
    await open.close();
  });

  it("asks no other host for anything while loading", () => {
    expect(open.refused).toEqual([]);
  });

  it("references no stylesheet or font on another host", async () => {
    const outside =
      /<link\b[^>]*\bhref=["']?(?:https?:)?\/\/|@import\s+(?:url\()?\s*["']?(?:https?:)?\/\/|url\(\s*["']?(?:https?:)?\/\//iu;
    const referencing = [];
    for (const file of await builtFiles()) {
      if (!/\.(?:html|css)$/u.test(file)) continue;
      if (outside.test(await readFile(file, "utf8"))) referencing.push(file);
    }
    expect(referencing).toEqual([]);
  });
});

describe("fitness: the page is static (hosting.md)", () => {
  it("builds to static files only", async () => {
    const files = await builtFiles();
    expect(files.map((file) => extname(file))).toContain(".html");
    const other = files.filter(
      (file) =>
        ![".html", ".js", ".css", ".woff2", ".svg", ".png", ".ico"].includes(
          extname(file),
        ),
    );
    expect(other).toEqual([]);
  });
});
