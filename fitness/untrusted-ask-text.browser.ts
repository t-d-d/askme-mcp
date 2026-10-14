import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { pagePaths, type AsksAnswer } from "../shared/page-api";
import { pageAsk } from "../test/asks";
import { openPage, type OpenPage } from "../test/browser";

const phone = { width: 390, height: 844 };

const reason =
  '<img src="https://evil.example/r.png" onerror="document.title=\'run\'"><a href="https://evil.example/">Tap</a> **now** [here](https://evil.example/)';

const list: AsksAnswer = {
  version: 1,
  everAsked: true,
  hashtags: [{ name: "shop", colour: 1 }],
  formerHashtags: [],
  asks: [
    pageAsk({
      id: "hostile",
      summary: "Merge the fix for checkout rounding?",
      spokenDetail: "The fix is ready, and the tests pass.",
      sort: { hashtags: ["shop"], level: "high", reason },
    }),
  ],
};

describe("fitness: the reason is inert (untrusted-ask-text.md)", () => {
  let view: OpenPage;
  beforeAll(async () => {
    view = await openPage(`${inject("pageUrl")}#ask/hostile`, phone, {
      session: "test-session-token",
      api: { [pagePaths.asks]: list },
    });
    await view.page.getByRole("link", { name: "All asks" }).waitFor();
  });
  afterAll(async () => {
    await view.close();
  });

  it("shows the reason on the open card as its own text, character for character", async () => {
    const shown = view.page.getByText(reason, { exact: true });
    expect(await shown.count()).toBe(1);
    expect(await shown.evaluate((element) => element.textContent)).toBe(reason);
  });

  it("makes no element of it", async () => {
    const shown = view.page.getByText(reason, { exact: true });
    expect(await shown.evaluate((element) => element.childElementCount)).toBe(
      0,
    );
    expect(await view.page.locator("img").count()).toBe(0);
    expect(
      await view.page.locator('a[href^="https://evil.example"]').count(),
    ).toBe(0);
  });

  it("loads nothing and runs nothing it names", async () => {
    expect(view.refused.filter((url) => url.includes("evil.example"))).toEqual(
      [],
    );
    expect(await view.page.title()).not.toBe("run");
  });
});
