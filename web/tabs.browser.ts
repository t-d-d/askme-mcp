// The tabs over the list: Everything, then one per hashtag, with Clerk and
// the page's API faked on loopback (ADR 9).
import { afterEach, describe, expect, inject, it } from "vitest";
import {
  pagePaths,
  type AsksAnswer,
  type Hashtag,
  type Level,
} from "../shared/page-api";
import {
  Answering,
  answerPoll,
  computedColour,
  openPage,
  type OpenPage,
} from "../test/browser";
import { palette } from "./src/palette";
import { pollMs } from "./src/poll";

type Page = OpenPage["page"];
type Locator = ReturnType<Page["locator"]>;

const phone = { width: 390, height: 844 };
const session = "test-session-token";

const minute = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const ask = (
  id: string,
  summary: string,
  waited: number,
  sort: { hashtags: string[]; level: Level } | null,
) => ({
  id,
  summary,
  spokenDetail: `The spoken detail of ${summary}`,
  postedAt: ago(waited),
  opened: false,
  sort: sort === null ? null : { ...sort, reason: "Sorted by the rules." },
});

// The rules name shop before work, so shop's tab comes first, though work
// took the first colour when it first appeared.
const hashtags: Hashtag[] = [
  { name: "shop", colour: 1 },
  { name: "work", colour: 0 },
  { name: "family", colour: 2 },
];

// The service gives each ask's hashtags in the rules' order.
const list: AsksAnswer = {
  version: 4,
  everAsked: true,
  hashtags,
  formerHashtags: [],
  asks: [
    ask("a", "Merge the fix for checkout rounding?", 30 * minute, {
      hashtags: ["shop", "work"],
      level: "high",
    }),
    ask("b", "Which date format should the export use?", 20 * minute, {
      hashtags: ["work"],
      level: "normal",
    }),
    ask("c", "Swap Saturday's school run?", 10 * minute, {
      hashtags: ["family"],
      level: "normal",
    }),
    ask("d", "Read the newsletter draft?", 5 * minute, {
      hashtags: [],
      level: "normal",
    }),
    ask("e", "Renew the shop's domain?", 1 * minute, null),
  ],
};

const open = (answer: AsksAnswer | Answering, clock = false) =>
  openPage(inject("pageUrl"), phone, {
    session,
    clock,
    api: { [pagePaths.asks]: answer },
  });

const tabs = (page: Page) =>
  page.getByRole("navigation", { name: "Hashtags" }).getByRole("button");

const tab = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "Hashtags" })
    .getByRole("button", { name, exact: true });

// Whether a control has the keyboard's focus.
const focused = (control: Locator) =>
  control.evaluate((element) => element === document.activeElement);

// The style of the outline around an element, as drawn now.
const outline = (element: Locator) =>
  element.evaluate((each) => getComputedStyle(each).outlineStyle);

const allClear = (page: Page) =>
  page.getByRole("heading", { name: "All clear." });

const summaries = async (page: Page) => [
  ...(await page.getByRole("article").allInnerTexts()),
  ...(await page.getByRole("listitem").allInnerTexts()),
];

// How a tab is drawn: the colour behind its name, and its text.
const looks = (control: Locator) =>
  control
    .locator("span")
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return { behind: style.backgroundColor, text: style.color };
    });

const drawn = async (page: Page, behind: string, text: string) => ({
  behind: await computedColour(page, behind),
  text: await computedColour(page, text),
});

// The colour an ask's buttons take: the strong colour its card or row
// hands to what it holds (styling.md).
const buttonColour = (element: Locator) =>
  element.evaluate((holder) => {
    const probe = document.createElement("span");
    probe.style.setProperty("color", "var(--tag-strong)");
    holder.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });

let view: OpenPage | undefined;
afterEach(async () => {
  await view?.close();
  view = undefined;
});

describe("the tabs", () => {
  it("are Everything first, then one per hashtag, in the rules' order", async () => {
    view = await open(list);
    await view.page.getByRole("article").waitFor();
    expect(await tabs(view.page).allInnerTexts()).toEqual([
      "Everything",
      "#shop",
      "#work",
      "#family",
    ]);
  });

  it("are only Everything when the rules give no hashtags", async () => {
    view = await open({ ...list, hashtags: [] });
    await view.page.getByRole("article").waitFor();
    expect(await tabs(view.page).allInnerTexts()).toEqual(["Everything"]);
    expect(
      await tab(view.page, "Everything").getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("start on Everything, which lists every ask", async () => {
    view = await open(list);
    const { page } = view;
    await page.getByRole("article").waitFor();
    expect(await tab(page, "Everything").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(await page.getByRole("listitem").count()).toBe(4);
  });

  it("list only the asks with that hashtag on a hashtag's tab", async () => {
    view = await open(list);
    const { page } = view;
    await page.getByRole("article").waitFor();
    await tab(page, "#work").click();
    await page.getByRole("heading", { name: "1 more waiting" }).waitFor();
    expect(await tab(page, "#work").getAttribute("aria-pressed")).toBe("true");
    expect(await tab(page, "Everything").getAttribute("aria-pressed")).toBe(
      "false",
    );
    const shown = await summaries(page);
    expect(shown).toHaveLength(2);
    expect(shown[0]).toContain("Merge the fix for checkout rounding?");
    expect(shown[1]).toContain("Which date format should the export use?");

    await tab(page, "#family").click();
    await page
      .getByRole("article")
      .filter({ hasText: "Swap Saturday's school run?" })
      .waitFor();
    expect(
      await page
        .getByRole("heading", { name: "Nothing else waiting" })
        .isVisible(),
    ).toBe(true);
    expect(await page.getByRole("listitem").count()).toBe(0);

    await tab(page, "Everything").click();
    await page.getByRole("heading", { name: "4 more waiting" }).waitFor();
  });

  it("say all clear on a hashtag's tab that has nothing waiting, and keep the tabs", async () => {
    view = await open({
      ...list,
      asks: list.asks.filter((each) => each.id !== "c"),
    });
    const { page } = view;
    await page.getByRole("article").waitFor();
    await tab(page, "#family").click();
    await page.getByRole("heading", { name: "All clear." }).waitFor();
    expect(await page.getByRole("article").count()).toBe(0);
    expect(await tab(page, "#family").getAttribute("aria-pressed")).toBe(
      "true",
    );
    await tab(page, "Everything").click();
    await page.getByRole("article").waitFor();
  });

  it("go back to Everything when the selected tab's hashtag leaves the rules", async () => {
    let answer = list;
    view = await open(new Answering((url) => answerPoll(url, answer)), true);
    const { page } = view;
    await page.getByRole("article").waitFor();
    await tab(page, "#family").click();
    await page.getByRole("listitem").first().waitFor({ state: "detached" });
    answer = {
      ...list,
      version: list.version + 1,
      hashtags: hashtags.filter(({ name }) => name !== "family"),
    };
    await page.clock.fastForward(pollMs);
    await page.getByRole("heading", { name: "4 more waiting" }).waitFor();
    expect(await tabs(page).allInnerTexts()).toEqual([
      "Everything",
      "#shop",
      "#work",
    ]);
    expect(await tab(page, "Everything").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("move focus to Everything when the focused tab's hashtag leaves the rules", async () => {
    let answer = list;
    view = await open(new Answering((url) => answerPoll(url, answer)), true);
    const { page } = view;
    await page.getByRole("article").waitFor();
    await tab(page, "#family").focus();
    answer = {
      ...list,
      version: list.version + 1,
      hashtags: hashtags.filter(({ name }) => name !== "family"),
    };
    await page.clock.fastForward(pollMs);
    await tab(page, "#family").waitFor({ state: "detached" });
    expect(await focused(tab(page, "Everything"))).toBe(true);
  });

  it("move focus to Everything when the selected tab's hashtag leaves the rules", async () => {
    let answer = list;
    view = await open(new Answering((url) => answerPoll(url, answer)), true);
    const { page } = view;
    await page.getByRole("article").waitFor();
    await tab(page, "#family").click();
    await page.getByRole("listitem").first().waitFor({ state: "detached" });
    answer = {
      ...list,
      version: list.version + 1,
      hashtags: hashtags.filter(({ name }) => name !== "family"),
    };
    await page.clock.fastForward(pollMs);
    await tab(page, "#family").waitFor({ state: "detached" });
    expect(await focused(tab(page, "Everything"))).toBe(true);
  });

  it("keep focus on a tab whose hashtag stays when another leaves the rules", async () => {
    let answer = list;
    view = await open(new Answering((url) => answerPoll(url, answer)), true);
    const { page } = view;
    await page.getByRole("article").waitFor();
    await tab(page, "#work").focus();
    answer = {
      ...list,
      version: list.version + 1,
      hashtags: hashtags.filter(({ name }) => name !== "family"),
    };
    await page.clock.fastForward(pollMs);
    await tab(page, "#family").waitFor({ state: "detached" });
    expect(await focused(tab(page, "#work"))).toBe(true);
  });

  it("stay on Everything when a hashtag that left the rules comes back", async () => {
    let answer = list;
    view = await open(new Answering((url) => answerPoll(url, answer)), true);
    const { page } = view;
    await page.getByRole("article").waitFor();
    await tab(page, "#family").click();
    await page.getByRole("listitem").first().waitFor({ state: "detached" });
    answer = {
      ...list,
      version: list.version + 1,
      hashtags: hashtags.filter(({ name }) => name !== "family"),
    };
    await page.clock.fastForward(pollMs);
    await page.getByRole("heading", { name: "4 more waiting" }).waitFor();
    answer = { ...list, version: list.version + 2 };
    await page.clock.fastForward(pollMs);
    await tab(page, "#family").waitFor();
    expect(await tab(page, "Everything").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(await page.getByRole("listitem").count()).toBe(4);
  });

  it("start again on Everything when a new ask ends an all clear", async () => {
    let answer = list;
    view = await open(new Answering((url) => answerPoll(url, answer)), true);
    const { page } = view;
    await page.getByRole("article").waitFor();
    await tab(page, "#family").click();
    await page.getByRole("listitem").first().waitFor({ state: "detached" });
    answer = { ...list, version: list.version + 1, asks: [] };
    await page.clock.fastForward(pollMs);
    await page.getByRole("heading", { name: "All clear." }).waitFor();
    answer = {
      ...list,
      version: list.version + 2,
      asks: list.asks.filter(({ id }) => id === "b"),
    };
    await page.clock.fastForward(pollMs);
    await page
      .getByRole("article")
      .filter({ hasText: "Which date format should the export use?" })
      .waitFor();
    expect(await tab(page, "Everything").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("move focus to All clear when the list goes all clear while a tab has focus", async () => {
    let answer = list;
    view = await open(new Answering((url) => answerPoll(url, answer)), true);
    const { page } = view;
    await page.getByRole("article").waitFor();
    // Reached from the keyboard, so the focus outline shows.
    await tab(page, "#shop").focus();
    await page.keyboard.press("Tab");
    expect(await focused(tab(page, "#work"))).toBe(true);
    expect(await outline(tab(page, "#work"))).toBe("solid");
    answer = { ...list, version: list.version + 1, asks: [] };
    await page.clock.fastForward(pollMs);
    await tab(page, "#work").waitFor({ state: "detached" });
    expect(await focused(allClear(page))).toBe(true);
    // The heading is not a control, so it draws no outline.
    expect(await outline(allClear(page))).toBe("none");
  });

  it("move focus to All clear when the focused tab already said all clear", async () => {
    let answer: AsksAnswer = {
      ...list,
      asks: list.asks.filter(({ id }) => id !== "c"),
    };
    view = await open(new Answering((url) => answerPoll(url, answer)), true);
    const { page } = view;
    await page.getByRole("article").waitFor();
    await tab(page, "#family").click();
    await allClear(page).waitFor();
    answer = { ...list, version: list.version + 1, asks: [] };
    await page.clock.fastForward(pollMs);
    await tab(page, "#family").waitFor({ state: "detached" });
    expect(await focused(allClear(page))).toBe(true);
  });

  it("leave focus where it is when the list goes all clear while no tab has focus", async () => {
    let answer = list;
    view = await open(new Answering((url) => answerPoll(url, answer)), true);
    const { page } = view;
    await page.getByRole("article").waitFor();
    const rules = page
      .getByRole("navigation", { name: "Settings" })
      .getByRole("link", { name: "Rules" });
    await rules.focus();
    answer = { ...list, version: list.version + 1, asks: [] };
    await page.clock.fastForward(pollMs);
    await tab(page, "Everything").waitFor({ state: "detached" });
    expect(await focused(rules)).toBe(true);
  });

  it("leave focus where it is when the list goes all clear after a card opened while a tab had focus", async () => {
    let answer = list;
    view = await open(new Answering((url) => answerPoll(url, answer)), true);
    const { page } = view;
    await page.getByRole("article").waitFor();
    // The tabs go as the card opens, with a tab still focused.
    await tab(page, "#work").focus();
    await page.evaluate(() => {
      window.location.hash = "#ask/b";
    });
    await tab(page, "#work").waitFor({ state: "detached" });
    await page.evaluate(() => {
      window.location.hash = "";
    });
    await tab(page, "#work").waitFor();
    const rules = page
      .getByRole("navigation", { name: "Settings" })
      .getByRole("link", { name: "Rules" });
    await rules.focus();
    answer = { ...list, version: list.version + 1, asks: [] };
    await page.clock.fastForward(pollMs);
    await tab(page, "Everything").waitFor({ state: "detached" });
    expect(await focused(rules)).toBe(true);
  });
});

describe("how the tabs look", () => {
  it("draws Everything in ink when selected, and in the neutral tint when not", async () => {
    view = await open(list);
    const { page } = view;
    await page.getByRole("article").waitFor();
    expect(await looks(tab(page, "Everything"))).toEqual(
      await drawn(page, "var(--ink)", "var(--ground)"),
    );
    await tab(page, "#work").click();
    await expect
      .poll(() => looks(tab(page, "Everything")))
      .toEqual(await drawn(page, "var(--neutral-tint)", "var(--ink)"));
  });

  it("draws a hashtag's tab in its strong colour with white text when selected, and in its tint with its ink when not", async () => {
    view = await open(list);
    const { page } = view;
    await page.getByRole("article").waitFor();
    expect(await looks(tab(page, "#shop"))).toEqual(
      await drawn(page, palette.orange.tint, palette.orange.ink),
    );
    expect(await looks(tab(page, "#work"))).toEqual(
      await drawn(page, palette.blue.tint, palette.blue.ink),
    );
    await tab(page, "#work").click();
    await expect
      .poll(() => looks(tab(page, "#work")))
      .toEqual(await drawn(page, palette.blue.strong, "white"));
    expect(await looks(tab(page, "#shop"))).toEqual(
      await drawn(page, palette.orange.tint, palette.orange.ink),
    );
  });

  it("makes every tab big enough to tap", async () => {
    view = await open(list);
    await view.page.getByRole("article").waitFor();
    for (const control of await tabs(view.page).all()) {
      const box = await control.boundingBox();
      expect(box?.height, await control.innerText()).toBeGreaterThanOrEqual(44);
      expect(box?.width, await control.innerText()).toBeGreaterThanOrEqual(44);
    }
  });

  it("wraps eight hashtags, so the page scrolls only up and down", async () => {
    const eight = [
      "groceries",
      "garden",
      "finance",
      "football",
      "holidays",
      "volunteering",
      "bookclub",
      "renovation",
    ].map((name, colour) => ({ name, colour }));
    view = await open({ ...list, hashtags: eight });
    const { page } = view;
    await page.getByRole("article").waitFor();
    expect(await tabs(page).count()).toBe(9);
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(scrollWidth).toBeLessThanOrEqual(phone.width);
  });
});

describe("the colour of an ask's buttons", () => {
  it("is its first hashtag's on Everything", async () => {
    view = await open(list);
    const { page } = view;
    const card = page.getByRole("article");
    await card.waitFor();
    expect(await buttonColour(card)).toBe(
      await computedColour(page, palette.orange.strong),
    );
    const rows = page.getByRole("listitem");
    expect(await buttonColour(rows.nth(0))).toBe(
      await computedColour(page, palette.blue.strong),
    );
    expect(await buttonColour(rows.nth(1))).toBe(
      await computedColour(page, palette.purple.strong),
    );
  });

  it("is the tab's on a hashtag's own tab, for every ask", async () => {
    view = await open(list);
    const { page } = view;
    await page.getByRole("article").waitFor();
    await tab(page, "#work").click();
    await page.getByRole("heading", { name: "1 more waiting" }).waitFor();
    const blue = await computedColour(page, palette.blue.strong);
    expect(await buttonColour(page.getByRole("article"))).toBe(blue);
    expect(await buttonColour(page.getByRole("listitem").nth(0))).toBe(blue);
  });

  it("keeps each of the top card's hashtags in its own colour on a hashtag's tab", async () => {
    view = await open(list);
    const { page } = view;
    await page.getByRole("article").waitFor();
    await tab(page, "#work").click();
    await page.getByRole("heading", { name: "1 more waiting" }).waitFor();
    const pill = (name: string) =>
      page
        .getByRole("article")
        .getByText(name, { exact: true })
        .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(await pill("#shop")).toBe(
      await computedColour(page, palette.orange.tint),
    );
    expect(await pill("#work")).toBe(
      await computedColour(page, palette.blue.tint),
    );
  });

  it("shows the tab's hashtag on each row of a hashtag's tab", async () => {
    view = await open({
      ...list,
      asks: [
        ask("x", "Which date format should the export use?", 40 * minute, {
          hashtags: ["work"],
          level: "high",
        }),
        ...list.asks,
      ],
    });
    const { page } = view;
    await page.getByRole("article").waitFor();
    await tab(page, "#work").click();
    const row = page
      .getByRole("listitem")
      .filter({ hasText: "Merge the fix for checkout rounding?" });
    await row.waitFor();
    expect(await row.innerText()).toContain("#work");
    expect(await row.innerText()).not.toContain("#shop");
    expect(
      await row
        .getByText("#work", { exact: true })
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ).toBe(await computedColour(page, palette.blue.tint));
  });
});

describe("an ask whose hashtag has left the rules", () => {
  // The rules no longer name work. Two asks still carry it, until they are
  // sorted again with the new rules.
  const changed: AsksAnswer = {
    ...list,
    hashtags: hashtags.filter(({ name }) => name !== "work"),
    formerHashtags: [{ name: "work", colour: 0 }],
    asks: [
      ask("b", "Which date format should the export use?", 20 * minute, {
        hashtags: ["work"],
        level: "high",
      }),
      ask("x", "Rename the export's columns?", 10 * minute, {
        hashtags: ["work"],
        level: "normal",
      }),
    ],
  };

  it("keeps the hashtag in its own colour, with no tab, until it is sorted again", async () => {
    view = await open(changed);
    const { page } = view;
    const card = page.getByRole("article");
    await card.waitFor();
    expect(await tabs(page).allInnerTexts()).toEqual([
      "Everything",
      "#shop",
      "#family",
    ]);
    expect(
      await card
        .getByText("#work", { exact: true })
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ).toBe(await computedColour(page, palette.blue.tint));
    const blue = await computedColour(page, palette.blue.strong);
    expect(await buttonColour(card)).toBe(blue);
    const row = page.getByRole("listitem");
    expect(await row.innerText()).toContain("#work");
    expect(await buttonColour(row)).toBe(blue);
  });
});
