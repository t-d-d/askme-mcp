// Holding asks back until their hours (PRD, "Web page"), with Clerk and the
// page's API faked on loopback (ADR 9). The page's clock is set, so each
// test knows which hours are open.
import { afterEach, describe, expect, inject, it } from "vitest";
import {
  askChangePaths,
  pagePaths,
  type AsksAnswer,
  type Hashtag,
  type Level,
} from "../shared/page-api";
import {
  answerPoll,
  Answering,
  openPage,
  Status,
  type OpenPage,
} from "../test/browser";
import { pollMs } from "./src/poll";

type Page = OpenPage["page"];

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
) => ({
  id,
  summary,
  spokenDetail: `The spoken detail of ${summary}`,
  postedAt: new Date(postedAt.getTime() - 30 * minute).toISOString(),
  opened: false,
  sort: { ...sort, reason: "Sorted for the test." },
});

// Two asks for work, one of them for the shop too, and one each for the
// shop and the family.
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

// The list, polled as the service answers: whole the first time, and as
// unchanged after that.
const open = (list: AsksAnswer, time: Date) =>
  openPage(inject("pageUrl"), phone, {
    session,
    clock: time,
    api: {
      [pagePaths.asks]: new Answering((url) => answerPoll(url, list)),
    },
  });

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

// The text of whatever comes straight after the tabs.
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
    // The last thing on the screen, below the All clear lines.
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
});
