import { afterEach, describe, expect, inject, it } from "vitest";
import {
  askChangePaths,
  pagePaths,
  weekdays,
  type AsksAnswer,
  type Hashtag,
  type Level,
} from "../shared/page-api";
import { pageAsk } from "../test/asks";
import {
  allClearGaps,
  answerPoll,
  Answering,
  openPage,
  Status,
  underTheNote,
  type OpenPage,
} from "../test/browser";
import { pollMs } from "./src/poll";
import { undoMs } from "./src/useDismissing";

type Page = OpenPage["page"];
type Locator = ReturnType<Page["locator"]>;

const phone = { width: 390, height: 844 };
const session = "test-session-token";
const minute = 60_000;

// Monday 12 October 2026, 7pm in London, where work's hours have closed.
const evening = new Date("2026-10-12T18:00:00Z");

// The next morning, 9am in London, where they are open.
const morning = new Date("2026-10-13T08:00:00Z");

const hashtags: Hashtag[] = [
  { name: "shop", colour: 1 },
  {
    name: "work",
    colour: 0,
    hours: [
      { days: ["mon", "tue", "wed", "thu", "fri"], from: "08:00", to: "18:00" },
    ],
  },
  { name: "family", colour: 2 },
];

const ask = (
  id: string,
  summary: string,
  postedAt: Date,
  sort: { hashtags: string[]; level: Level },
) =>
  pageAsk({
    id,
    summary,
    postedAt: new Date(postedAt.getTime() - 30 * minute).toISOString(),
    sort: { ...sort, reason: "Sorted for the test." },
  });

const asksAt = (time: Date) => [
  ask("a", "Merge the fix for checkout rounding?", time, {
    hashtags: ["shop", "work"],
    level: "high",
  }),
  ask("b", "Which date format should the export use?", time, {
    hashtags: ["work"],
    level: "normal",
  }),
  ask("c", "Swap Saturday's school run?", time, {
    hashtags: ["family"],
    level: "normal",
  }),
  ask("d", "Renew the shop's domain?", time, {
    hashtags: ["shop"],
    level: "low",
  }),
];

const listOf = (asks: AsksAnswer["asks"]): AsksAnswer => ({
  version: 3,
  everAsked: true,
  hashtags,
  formerHashtags: [],
  timeZone: "Europe/London",
  asks,
});

const open = (list: AsksAnswer, time: Date, screen = phone) =>
  openPage(inject("pageUrl"), screen, {
    session,
    clock: time,
    api: {
      [pagePaths.asks]: new Answering((url) => answerPoll(url, list)),
      [askChangePaths.dismissed]: new Status(204),
    },
  });

const openChanging = async (list: AsksAnswer, time: Date) => {
  let answer = list;
  const opened = await openPage(inject("pageUrl"), phone, {
    session,
    clock: time,
    api: {
      [pagePaths.asks]: new Answering((url) => answerPoll(url, answer)),
    },
  });
  return {
    opened,
    answerWith: (next: AsksAnswer) => {
      answer = next;
    },
  };
};

const summaries = async (page: Page) => [
  ...(await page.getByRole("article").allInnerTexts()),
  ...(await page.getByRole("listitem").allInnerTexts()),
];

const shows = async (page: Page, summary: string) =>
  (await summaries(page)).some((text) => text.includes(summary));

const tab = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "Hashtags" })
    .getByRole("button", { name, exact: true });

const focused = (control: Locator) =>
  control.evaluate((element) => element === document.activeElement);

const underTheTabs = (page: Page) =>
  page.evaluate(
    () =>
      document.querySelector('nav[aria-label="Hashtags"]')?.nextElementSibling
        ?.textContent ?? null,
  );

let view: OpenPage | undefined;
afterEach(async () => {
  await view?.close();
  view = undefined;
});

describe("holding asks back until their hours", () => {
  it("holds back an ask with any hashtag outside its hours, and says how many under the tabs", async () => {
    view = await open(listOf(asksAt(evening)), evening);
    const { page } = view;
    await page.getByRole("article").waitFor();
    expect(await shows(page, "Swap Saturday's school run?")).toBe(true);
    expect(await shows(page, "Renew the shop's domain?")).toBe(true);
    // The shop has no hours, but the work hashtag holds the ask all the same.
    expect(await shows(page, "Merge the fix for checkout rounding?")).toBe(
      false,
    );
    expect(await shows(page, "Which date format should the export use?")).toBe(
      false,
    );
    expect(await underTheTabs(page)).toBe("2 held until their hoursShow them");
    const show = page.getByRole("button", { name: "Show them" });
    const box = await show.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  });

  it("shows the held asks after Show them, says how many are showing, and hides them again", async () => {
    view = await open(listOf(asksAt(evening)), evening);
    const { page } = view;
    await page.getByRole("button", { name: "Show them" }).click();
    await page.getByText("Showing 2 held asks").waitFor();
    expect(await shows(page, "Merge the fix for checkout rounding?")).toBe(
      true,
    );
    expect(await shows(page, "Which date format should the export use?")).toBe(
      true,
    );
    await page.getByRole("button", { name: "Hide them" }).click();
    await page.getByText("2 held until their hours").waitFor();
    expect(await shows(page, "Which date format should the export use?")).toBe(
      false,
    );
  });

  it("works the same on every tab, and is not there on one with nothing held", async () => {
    view = await open(listOf(asksAt(evening)), evening);
    const { page } = view;
    await page.getByRole("article").waitFor();

    await tab(page, "#shop").click();
    await page.getByText("1 held until its hours").waitFor();
    expect(await underTheTabs(page)).toBe("1 held until its hoursShow them");
    expect(await summaries(page)).toEqual([
      expect.stringContaining("Renew the shop's domain?"),
    ]);

    // Everything on work's tab is held, so it is all clear, under the line.
    await tab(page, "#work").click();
    await page.getByRole("heading", { name: "All clear." }).waitFor();
    expect(await underTheTabs(page)).toBe("2 held until their hoursShow them");

    await tab(page, "#family").click();
    await page.getByRole("article").waitFor();
    expect(await page.getByText(/held/u).count()).toBe(0);
  });

  it("is not there when nothing is held", async () => {
    view = await open(listOf(asksAt(morning)), morning);
    const { page } = view;
    await page.getByRole("article").waitFor();
    expect(await summaries(page)).toHaveLength(4);
    expect(await page.getByText(/held/u).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Show them" }).count()).toBe(
      0,
    );
  });

  it("sits at the foot of All clear when every ask is held, and Show them brings the tabs back", async () => {
    view = await open(listOf(asksAt(evening).slice(0, 2)), evening);
    const { page } = view;
    await page.getByRole("heading", { name: "All clear." }).waitFor();
    expect(
      await page.getByRole("navigation", { name: "Hashtags" }).count(),
    ).toBe(0);
    const line = page.getByText("2 held until their hours");
    await line.waitFor();
    // The held line sits below All clear's last line.
    const below = await page.evaluate(() => {
      const lines = [...document.querySelectorAll("main p")];
      const last = lines.at(-1)?.getBoundingClientRect().bottom ?? 0;
      const held = [...document.querySelectorAll("span")].find(
        (span) => span.textContent === "2 held until their hours",
      );
      return (held?.getBoundingClientRect().top ?? 0) - last;
    });
    expect(below).toBeGreaterThan(0);
    const foot = await line.boundingBox();
    expect((foot?.y ?? 0) + (foot?.height ?? 0)).toBeGreaterThan(
      phone.height - 120,
    );

    await page.getByRole("button", { name: "Show them" }).click();
    await page.getByRole("navigation", { name: "Hashtags" }).waitFor();
    expect(await underTheTabs(page)).toBe("Showing 2 held asksHide them");
    expect(await summaries(page)).toHaveLength(2);
  });

  // A third of the way down: the space above is half the space below.
  it("leaves All clear a third of the way down the space above it", async () => {
    view = await open(listOf(asksAt(evening).slice(0, 2)), evening);
    const { page } = view;
    await page.getByText("2 held until their hours").waitFor();
    const { above, below } = await allClearGaps(
      page,
      "2 held until their hours",
    );
    expect(Math.abs(above - below / 2)).toBeLessThanOrEqual(4);
  });

  it("leaves All clear on a tab a third of the way down the space under the tabs", async () => {
    view = await open(listOf(asksAt(evening)), evening);
    const { page } = view;
    await page.getByRole("article").waitFor();
    await tab(page, "#work").click();
    await page.getByRole("heading", { name: "All clear." }).waitFor();
    const { above, below } = await allClearGaps(page);
    expect(Math.abs(above - below / 2)).toBeLessThanOrEqual(4);
  });

  it("keeps focus on its control when Show them at the foot of All clear brings the tabs back", async () => {
    view = await open(listOf(asksAt(evening).slice(0, 2)), evening);
    const { page } = view;
    await page.getByRole("heading", { name: "All clear." }).waitFor();
    await page.getByRole("button", { name: "Show them" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("navigation", { name: "Hashtags" }).waitFor();
    expect(await focused(page.getByRole("button", { name: "Hide them" }))).toBe(
      true,
    );
  });

  it("keeps focus on its control when Hide them under the tabs makes the list all clear", async () => {
    view = await open(listOf(asksAt(evening).slice(0, 2)), evening);
    const { page } = view;
    await page.getByRole("button", { name: "Show them" }).click();
    await page.getByRole("navigation", { name: "Hashtags" }).waitFor();
    await page.getByRole("button", { name: "Hide them" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { name: "All clear." }).waitFor();
    expect(await focused(page.getByRole("button", { name: "Show them" }))).toBe(
      true,
    );
  });

  it("moves focus to the selected tab when it goes at a poll with focus, and the tabs stay", async () => {
    // Tuesday, a minute before work's hours open in London.
    const early = new Date("2026-10-13T06:59:00Z");
    view = await open(listOf(asksAt(early)), early);
    const { page } = view;
    await tab(page, "#shop").click();
    await page.getByText("1 held until its hours").waitFor();
    const show = page.getByRole("button", { name: "Show them" });
    await show.focus();
    expect(await focused(show)).toBe(true);
    await page.clock.fastForward(minute + pollMs);
    await page.getByText(/held/u).waitFor({ state: "detached" });
    expect(await focused(tab(page, "#shop"))).toBe(true);
  });

  it("moves focus to Everything when it goes at a poll with focus at the foot of All clear, and the tabs come back", async () => {
    // Tuesday, a minute before work's hours open in London.
    const early = new Date("2026-10-13T06:59:00Z");
    view = await open(listOf(asksAt(early).slice(0, 2)), early);
    const { page } = view;
    await page.getByRole("heading", { name: "All clear." }).waitFor();
    await page.getByRole("button", { name: "Show them" }).focus();
    await page.clock.fastForward(minute + pollMs);
    await page.getByRole("navigation", { name: "Hashtags" }).waitFor();
    expect(await page.getByText(/held/u).count()).toBe(0);
    expect(await focused(tab(page, "Everything"))).toBe(true);
  });

  // Vitest sets NODE_ENV to "test", so the page here is built with React's
  // development code. Its StrictMode detaches the new tabs' ref and attaches
  // it again after focus has moved into them.
  it("leaves focus where it is when the list goes all clear after it went to Everything as the tabs came back", async () => {
    // Tuesday, a minute before work's hours open in London.
    const early = new Date("2026-10-13T06:59:00Z");
    const list = listOf(asksAt(early).slice(0, 2));
    const changing = await openChanging(list, early);
    view = changing.opened;
    const { page } = view;
    await page.getByRole("heading", { name: "All clear." }).waitFor();
    await page.getByRole("button", { name: "Show them" }).focus();
    await page.clock.fastForward(minute + pollMs);
    await page.getByRole("navigation", { name: "Hashtags" }).waitFor();
    expect(await focused(tab(page, "Everything"))).toBe(true);
    const rules = page.getByRole("link", { name: "Rules" });
    await rules.focus();
    changing.answerWith({ ...list, version: list.version + 1, asks: [] });
    await page.clock.fastForward(pollMs);
    await page
      .getByRole("navigation", { name: "Hashtags" })
      .waitFor({ state: "detached" });
    expect(await focused(rules)).toBe(true);
  });

  it("moves focus to All clear when it goes at a poll with focus at the foot of All clear", async () => {
    const list = listOf(asksAt(evening).slice(0, 2));
    const changing = await openChanging(list, evening);
    view = changing.opened;
    const { page } = view;
    await page.getByRole("heading", { name: "All clear." }).waitFor();
    await page.getByRole("button", { name: "Show them" }).focus();
    changing.answerWith({ ...list, version: list.version + 1, asks: [] });
    await page.clock.fastForward(pollMs);
    await page.getByText(/held/u).waitFor({ state: "detached" });
    expect(
      await focused(page.getByRole("heading", { name: "All clear." })),
    ).toBe(true);
  });

  it("moves focus to All clear when it goes at a poll with focus under the tabs, and the tabs go", async () => {
    const list = listOf(asksAt(evening).slice(0, 2));
    const changing = await openChanging(list, evening);
    view = changing.opened;
    const { page } = view;
    await page.getByRole("button", { name: "Show them" }).click();
    await page.getByRole("navigation", { name: "Hashtags" }).waitFor();
    await page.getByRole("button", { name: "Hide them" }).focus();
    changing.answerWith({ ...list, version: list.version + 1, asks: [] });
    await page.clock.fastForward(pollMs);
    await page
      .getByRole("navigation", { name: "Hashtags" })
      .waitFor({ state: "detached" });
    expect(
      await focused(page.getByRole("heading", { name: "All clear." })),
    ).toBe(true);
  });

  it("leaves focus where it is when the line comes back after going with focus", async () => {
    // Tuesday, a minute before work's hours open in London.
    const early = new Date("2026-10-13T06:59:00Z");
    const list = listOf(asksAt(early));
    const changing = await openChanging(list, early);
    view = changing.opened;
    const { page } = view;
    await page.getByRole("button", { name: "Show them" }).focus();
    await page.clock.fastForward(minute + pollMs);
    await page.getByText(/held/u).waitFor({ state: "detached" });
    await tab(page, "#shop").focus();
    // The family's hours become the evening's, so its ask is held.
    const evenings = { days: [...weekdays], from: "18:00", to: "23:00" };
    changing.answerWith({
      ...list,
      version: list.version + 1,
      hashtags: hashtags.map((hashtag) =>
        hashtag.name === "family" ? { ...hashtag, hours: [evenings] } : hashtag,
      ),
    });
    await page.clock.fastForward(pollMs);
    await page.getByText("1 held until its hours").waitFor();
    expect(await focused(tab(page, "#shop"))).toBe(true);
  });

  it("lets an ask go when its hours open, with no reload", async () => {
    // Tuesday, a minute before work's hours open in London.
    const early = new Date("2026-10-13T06:59:00Z");
    view = await open(listOf(asksAt(early)), early);
    const { page } = view;
    await page.getByText("2 held until their hours").waitFor();
    await page.clock.fastForward(minute + pollMs);
    await page
      .getByRole("article")
      .filter({ hasText: "Merge the fix for checkout rounding?" })
      .waitFor();
    expect(await page.getByText(/held/u).count()).toBe(0);
    expect(await summaries(page)).toHaveLength(4);
  });

  it("lets an ask go when its hours open, though the page cannot reach askme", async () => {
    const early = new Date("2026-10-13T06:59:00Z");
    const list = listOf(asksAt(early));
    let polls = 0;
    view = await openPage(inject("pageUrl"), phone, {
      session,
      clock: early,
      api: {
        [pagePaths.asks]: new Answering(() => {
          polls += 1;
          return polls === 1 ? list : new Status(503);
        }),
      },
    });
    const { page } = view;
    await page.getByText("2 held until their hours").waitFor();
    await page.clock.fastForward(minute + pollMs);
    await page.getByText("Not connected. Trying again.").waitFor();
    await page
      .getByRole("article")
      .filter({ hasText: "Merge the fix for checkout rounding?" })
      .waitFor();
    expect(await page.getByText(/held/u).count()).toBe(0);
  });
});

describe("holding, with cards opened and dismissed", () => {
  it("brings a dismissed held ask back shown with Undo, though it was the only one held", async () => {
    // Only the export question is held.
    const list = listOf(asksAt(evening).slice(1));
    view = await openPage(inject("pageUrl"), phone, {
      session,
      clock: evening,
      api: {
        [pagePaths.asks]: new Answering((url) => answerPoll(url, list)),
        [askChangePaths.dismissed]: new Status(204),
      },
    });
    const { page } = view;
    const held = "Which date format should the export use?";
    await page.getByRole("button", { name: "Show them" }).click();
    await page.getByText("Showing 1 held ask").waitFor();
    await page.getByRole("link", { name: held }).click();
    await page.getByRole("button", { name: "Dismiss" }).click();
    await page.getByRole("button", { name: "Undo" }).click();
    await page.getByText("Showing 1 held ask").waitFor();
    expect(await shows(page, held)).toBe(true);
  });

  it("keeps the tab's colour on an open card when its hours close and every ask is held", async () => {
    // Monday, two minutes before work's hours close in London.
    const late = new Date("2026-10-12T16:58:00Z");
    view = await open(listOf(asksAt(late).slice(0, 2)), late);
    const { page, apiCalls } = view;
    await page.getByRole("article").waitFor();
    await tab(page, "#work").click();
    await page
      .getByRole("link", { name: "Merge the fix for checkout rounding?" })
      .click();
    const card = page
      .locator("div[style]")
      .filter({ has: page.getByRole("link", { name: "All asks" }) });
    const before = await card.getAttribute("style");
    const polls = apiCalls.length;
    await page.clock.fastForward(3 * minute + pollMs);
    await expect.poll(() => apiCalls.length).toBeGreaterThan(polls);
    await page.clock.runFor(100);
    expect(await card.getAttribute("style")).toBe(before);
  });

  it("puts focus on the next row after Dismiss, though the ask's hours closed while its card was open", async () => {
    // Monday, two minutes before work's hours close in London.
    const late = new Date("2026-10-12T16:58:00Z");
    const list = listOf([
      ask("d", "Renew the shop's domain?", late, {
        hashtags: ["shop"],
        level: "high",
      }),
      ask("b", "Which date format should the export use?", late, {
        hashtags: ["work"],
        level: "normal",
      }),
      ask("c", "Swap Saturday's school run?", late, {
        hashtags: ["family"],
        level: "low",
      }),
    ]);
    view = await openPage(inject("pageUrl"), phone, {
      session,
      clock: late,
      api: {
        [pagePaths.asks]: new Answering((url) => answerPoll(url, list)),
        [askChangePaths.dismissed]: new Status(204),
      },
    });
    const { page, apiCalls } = view;
    await page.getByRole("article").waitFor();
    await page
      .getByRole("link", {
        name: /^Which date format should the export use\?/u,
      })
      .click();
    await page.getByRole("link", { name: "All asks" }).waitFor();
    const polls = apiCalls.length;
    await page.clock.fastForward(3 * minute + pollMs);
    await expect.poll(() => apiCalls.length).toBeGreaterThan(polls);
    await page.clock.runFor(100);
    await page.getByRole("button", { name: "Dismiss" }).click();
    await page.getByRole("button", { name: "Undo" }).waitFor();
    const row = page.getByRole("listitem");
    expect(await row.innerText()).toContain("Swap Saturday's school run?");
    expect(await focused(row.getByRole("link"))).toBe(true);
  });

  // The page's time stands still, so the note with Undo stays until the test
  // moves it on.
  async function dismissTheLastShowing(page: Page) {
    const showing = "Swap Saturday's school run?";
    await page.getByRole("link", { name: showing }).waitFor();
    await page.clock.pauseAt(new Date(evening.getTime() + minute));
    await page.getByRole("link", { name: showing }).click();
    await page.getByRole("button", { name: "Dismiss" }).click();
    await page.getByRole("heading", { name: "All clear." }).waitFor();
    await page.getByRole("button", { name: "Undo" }).waitFor();
  }

  it.each([
    ["390 by 844", phone],
    ["360 by 690", { width: 360, height: 690 }],
  ])(
    "leaves All clear's headline where it is, with the line under it, on a %s screen while the note shows and after it goes",
    async (_, screen) => {
      view = await open(listOf(asksAt(evening).slice(0, 3)), evening, screen);
      const { page } = view;
      await dismissTheLastShowing(page);
      const line = "2 held until their hours";
      const { last, foot, note } = await underTheNote(page, line);
      expect(last).toBeLessThanOrEqual(note);
      expect(foot).toBeLessThanOrEqual(note);
      const noted = await allClearGaps(page, line);
      await page.clock.runFor(undoMs + 500);
      await page.getByRole("status").waitFor({ state: "hidden" });
      const gone = await allClearGaps(page, line);
      expect(Math.abs(noted.above - gone.above)).toBeLessThanOrEqual(1);
    },
  );

  // Some are too short to hold the headline where it is, and some too short
  // for All clear at all, so the page scrolls.
  it("keeps All clear's last line and the line under it clear of the note on short screens", async () => {
    view = await open(listOf(asksAt(evening).slice(0, 3)), evening);
    const { page } = view;
    await dismissTheLastShowing(page);
    const line = "2 held until their hours";
    for (const height of [400, 480, 560, 640]) {
      await page.setViewportSize({ width: 360, height });
      const { last, foot, note } = await underTheNote(page, line);
      expect(last).toBeLessThanOrEqual(note);
      expect(foot).toBeLessThanOrEqual(note);
      // The line moves up out of the note's way, but not over the last line.
      expect((await allClearGaps(page, line)).below).toBeGreaterThan(0);
    }
  });
});
