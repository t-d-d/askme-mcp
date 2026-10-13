import { afterEach, describe, expect, inject, it } from "vitest";
import {
  pagePaths,
  type AsksAnswer,
  type PageAsk,
  type RulesAnswer,
} from "../shared/page-api";
import { openPage, type OpenPage } from "../test/browser";

const phone = { width: 390, height: 844 };
const minute = 60_000;

const ask = (id: string, summary: string, waited: number): PageAsk => ({
  id,
  summary,
  spokenDetail: `The spoken detail of ${summary}`,
  postedAt: new Date(Date.now() - waited).toISOString(),
  opened: false,
  sort: { hashtags: ["shop"], level: "normal", reason: "Routine." },
  sessionLink: "https://claude.ai/code/session_01AbC",
});

const list: AsksAnswer = {
  version: 1,
  everAsked: true,
  hashtags: [{ name: "shop", colour: 1 }],
  formerHashtags: [],
  // The older ask is the top card.
  asks: [
    ask("top", "Merge it?", 20 * minute),
    ask("row", "Which date format?", 10 * minute),
  ],
};

const rules: RulesAnswer = {
  text: "#shop is my online shop.",
  hashtags: [{ name: "shop", colour: 1 }],
  readFailed: false,
  timeZone: "Europe/London",
};

let view: OpenPage | undefined;
afterEach(async () => {
  await view?.close();
  view = undefined;
});

async function open(fragment = ""): Promise<OpenPage> {
  view = await openPage(`${inject("pageUrl")}${fragment}`, phone, {
    session: "test-session-token",
    speech: "recorded",
    api: {
      [pagePaths.asks]: list,
      [pagePaths.rules]: rules,
      [pagePaths.connection]: { mcpUrl: "https://askme.example/mcp" },
    },
  });
  return view;
}

const focused = (page: OpenPage["page"]) =>
  page.evaluate(() => {
    const now = document.activeElement;
    return now === null || now === document.body
      ? "body"
      : `${now.tagName.toLowerCase()}: ${now.textContent}`;
  });

// Focus is on the heading, which draws no outline, and Tab goes on past it
// and back without stopping on it.
async function expectHeadingFocus(page: OpenPage["page"], heading: string) {
  const title = page.getByRole("heading", { level: 1, name: heading });
  await expect.poll(() => focused(page)).toBe(`h1: ${heading}`);
  expect(
    await title.evaluate((each) => getComputedStyle(each).outlineStyle),
  ).toBe("none");
  await page.keyboard.press("Tab");
  const next = await focused(page);
  expect(next).not.toBe(`h1: ${heading}`);
  expect(next).not.toBe("body");
  await page.keyboard.press("Shift+Tab");
  expect(await focused(page)).not.toBe(`h1: ${heading}`);
}

describe("reaching a screen by following a link", () => {
  it("opens a card with focus on its summary, titled Ask, and the list titled askme again", async () => {
    const { page } = await open();
    await page.getByRole("article").waitFor();
    expect(await page.title()).toBe("askme");
    await page
      .getByRole("listitem")
      .getByRole("link", { name: /^Which date format\?/u })
      .click();
    await page.getByRole("button", { name: "Dismiss" }).waitFor();
    expect(await page.title()).toBe("Ask | askme");
    await expectHeadingFocus(page, "Which date format?");
    await page.getByRole("link", { name: "All asks" }).click();
    await page.getByRole("article").waitFor();
    expect(await page.title()).toBe("askme");
  });

  it("opens Rules and then Connect with focus on each one's heading and its own title", async () => {
    const { page } = await open();
    await page.getByRole("article").waitFor();
    await page.getByRole("link", { name: "Rules", exact: true }).click();
    await page.getByRole("heading", { level: 1, name: "Your rules" }).waitFor();
    expect(await page.title()).toBe("Your rules | askme");
    await expectHeadingFocus(page, "Your rules");
    await page.getByRole("link", { name: "Connect agents" }).click();
    await page
      .getByRole("heading", { level: 1, name: "Connect your agents" })
      .waitFor();
    expect(await page.title()).toBe("Connect your agents | askme");
    await expectHeadingFocus(page, "Connect your agents");
    await page.goBack();
    await page.getByRole("heading", { level: 1, name: "Your rules" }).waitFor();
    expect(await page.title()).toBe("Your rules | askme");
    await page.getByRole("link", { name: "All asks" }).click();
    await page.getByRole("article").waitFor();
    expect(await page.title()).toBe("askme");
  });
});

describe("a screen the page opens on", () => {
  it.each([
    ["#rules", "Your rules", "Your rules | askme"],
    ["#connect", "Connect your agents", "Connect your agents | askme"],
    ["#ask/row", "Which date format?", "Ask | askme"],
  ])(
    "at %s takes its title and leaves focus where the browser put it",
    async (fragment, heading, title) => {
      const { page } = await open(fragment);
      await page.getByRole("heading", { level: 1, name: heading }).waitFor();
      expect(await page.title()).toBe(title);
      expect(await focused(page)).toBe("body");
    },
  );
});
