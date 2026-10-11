import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { openPage, type OpenPage } from "../test/browser";

const phone = { width: 390, height: 844 };
const desktop = { width: 1280, height: 800 };

const headline = "Your agents ask here. You decide what gets through.";
const about =
  "One place where all your AI agents ask for your input, sorted by rules you write in plain English.";
const notice =
  "This is a demo. Every ask is deleted after a month, and sign-ups stop at 100 accounts.";

async function builtFiles(): Promise<string[]> {
  const dir = inject("pageDir");
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

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

  it("has no sign-up button yet", async () => {
    const { page } = open;
    expect(await page.getByRole("button").count()).toBe(0);
    expect(await page.getByRole("link").count()).toBe(0);
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
    open = await openPage(inject("pageUrl"), phone);
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
