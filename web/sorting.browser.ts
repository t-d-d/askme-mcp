// The sorting line (docs/design.md, "The sorting line"), with Clerk and the
// page's API faked on loopback (ADR 9). The page's clock is set, so each
// test knows which asks are still being sorted.
import { afterEach, describe, expect, inject, it } from "vitest";
import {
  askChangePaths,
  pagePaths,
  type AsksAnswer,
  type Hashtag,
} from "../shared/page-api";
import {
  allClearGaps,
  answerPoll,
  Answering,
  computedColour,
  openPage,
  Status,
  underTheNote,
  type OpenPage,
} from "../test/browser";
import { pollMs } from "./src/poll";

type Page = OpenPage["page"];

const phone = { width: 390, height: 844 };
const session = "test-session-token";
const minute = 60_000;

// Monday 12 October 2026, 7pm in London, where work's hours have closed.
const evening = new Date("2026-10-12T18:00:00Z");

const hashtags: Hashtag[] = [
  { name: "shop", colour: 1 },
  {
    name: "work",
    colour: 0,
    hours: [
      { days: ["mon", "tue", "wed", "thu", "fri"], from: "08:00", to: "18:00" },
    ],
  },
];

// An ask sorted into a hashtag, and behind the rules until a time when one
// is given.
const ask = (id: string, hashtag: string, sortingUntil?: Date) => ({
  id,
  summary: `Ask ${id}`,
  spokenDetail: `The spoken detail of ask ${id}`,
  postedAt: new Date(evening.getTime() - 30 * minute).toISOString(),
  opened: false,
  sort: { hashtags: [hashtag], level: "normal" as const, reason: "Sorted." },
  ...(sortingUntil === undefined
    ? {}
    : { sortingUntil: sortingUntil.toISOString() }),
});

const listOf = (asks: AsksAnswer["asks"]): AsksAnswer => ({
  version: 3,
  everAsked: true,
  hashtags,
  formerHashtags: [],
  timeZone: "Europe/London",
  asks,
});

// The API takes a dismissal. The browser's time zone is the machine's
// unless one is given.
const open = (
  list: AsksAnswer,
  time = evening,
  screen = phone,
  timeZone?: string,
) =>
  openPage(inject("pageUrl"), screen, {
    session,
    clock: time,
    ...(timeZone === undefined ? {} : { timeZone }),
    api: {
      [pagePaths.asks]: new Answering((url) => answerPoll(url, list)),
      [askChangePaths.dismissed]: new Status(204),
    },
  });

// The line under the tabs that says how sorting stands, found by its words.
const line = (page: Page) =>
  page.getByText(
    /^Sorting \d+ asks? with your rules$|couldn't be sorted|sorting limit is reached/u,
  );

const later = new Date(evening.getTime() + 10 * minute);
const earlier = new Date(evening.getTime() - 10 * minute);

let view: OpenPage | undefined;
afterEach(async () => {
  await view?.close();
  view = undefined;
});

describe("the sorting line", () => {
  it("says how many asks are being sorted, under the tabs", async () => {
    view = await open(
      listOf([
        ask("a", "shop", later),
        ask("b", "shop", later),
        ask("c", "shop"),
      ]),
    );
    const { page } = view;
    await page.getByText("Sorting 2 asks with your rules").waitFor();
    expect(await line(page).count()).toBe(1);
  });

  it("says how many asks couldn't be sorted, once none is being sorted", async () => {
    view = await open(listOf([ask("a", "shop", earlier), ask("b", "shop")]));
    await view.page
      .getByText("1 ask couldn't be sorted. Saving your rules tries again.")
      .waitFor();
  });

  it("says only that asks are being sorted while some are, though others stopped", async () => {
    view = await open(
      listOf([ask("a", "shop", later), ask("b", "shop", earlier)]),
    );
    const { page } = view;
    await page.getByText("Sorting 1 ask with your rules").waitFor();
    expect(await line(page).count()).toBe(1);
  });

  it("is not there when every ask is sorted with the rules in force", async () => {
    view = await open(listOf([ask("a", "shop"), ask("b", "shop")]));
    const { page } = view;
    await page.getByRole("article").waitFor();
    expect(await line(page).count()).toBe(0);
  });

  it("shows on every tab, counting every ask, held ones included", async () => {
    view = await open(
      listOf([ask("a", "shop", later), ask("b", "work", later)]),
    );
    const { page } = view;
    await page.getByText("Sorting 2 asks with your rules").waitFor();
    await page
      .getByRole("navigation", { name: "Hashtags" })
      .getByRole("button", { name: "#shop", exact: true })
      .click();
    expect(
      await page.getByText("Sorting 2 asks with your rules").isVisible(),
    ).toBe(true);
  });

  it("sits below the held and lapsed lines when they show", async () => {
    const lapsedAsk = {
      ...ask("c", "shop", later),
      lapsesAt: earlier.toISOString(),
    };
    view = await open(
      listOf([ask("a", "work", later), ask("b", "shop", later), lapsedAsk]),
    );
    const { page } = view;
    const sorting = page.getByText("Sorting 3 asks with your rules");
    await sorting.waitFor();
    const sortingBox = await sorting.boundingBox();
    for (const above of ["1 held until its hours", "1 has lapsed"]) {
      const box = await page.getByText(above).boundingBox();
      expect(sortingBox?.y, above).toBeGreaterThan(
        (box?.y ?? Infinity) + (box?.height ?? 0),
      );
    }
  });

  it("looks like the held line, in the size and colour of a note", async () => {
    view = await open(
      listOf([ask("a", "work", later), ask("b", "shop", later)]),
    );
    const { page } = view;
    // A line's text colour and size, as the browser computes them.
    const style = (text: string) =>
      page.getByText(text).evaluate((element) => {
        const computed = getComputedStyle(element);
        return [computed.color, computed.getPropertyValue("font-size")];
      });
    // Where a line's first thing starts: the held line's clock, and the
    // sorting line's words.
    const start = (text: string) =>
      page.getByText(text).evaluate((element) => {
        const first = element.parentElement?.firstElementChild;
        const range = document.createRange();
        range.selectNodeContents(element);
        return element.tagName === "SPAN" && first instanceof SVGElement
          ? first.getBoundingClientRect().left
          : range.getBoundingClientRect().left;
      });
    await page.getByText("Sorting 2 asks with your rules").waitFor();
    const sorting = await style("Sorting 2 asks with your rules");
    expect(sorting).toEqual(await style("1 held until its hours"));
    expect(sorting[0]).toBe(await computedColour(page, "var(--text-2)"));
    expect(await start("Sorting 2 asks with your rules")).toBe(
      await start("1 held until its hours"),
    );
  });
});

describe("the sorting line while today's sorting limit is reached", () => {
  // The cap on model calls resets at midnight UTC: 1am in London, and 8pm
  // the evening before in New York.
  const resets = "2026-10-13T00:00:00.000Z";
  const capped = (asks: AsksAnswer["asks"]): AsksAnswer => ({
    ...listOf(asks),
    modelCapResetsAt: resets,
  });

  it("says the limit is reached and when it resets, in the person's time zone, in place of the rest", async () => {
    view = await open(
      capped([ask("a", "shop", later), ask("b", "shop", earlier)]),
      evening,
      phone,
      "Europe/London",
    );
    const { page } = view;
    await page
      .getByText("Today's sorting limit is reached. It resets at 01:00.")
      .waitFor();
    expect(await line(page).count()).toBe(1);
  });

  it("gives the time the limit resets on the clock where the person is", async () => {
    view = await open(
      capped([ask("a", "shop")]),
      evening,
      phone,
      "America/New_York",
    );
    await view.page
      .getByText("Today's sorting limit is reached. It resets at 20:00.")
      .waitFor();
  });

  it("shows at the foot of All clear, even with no asks open", async () => {
    view = await open(capped([]), evening, phone, "Europe/London");
    const { page } = view;
    await page.getByRole("heading", { name: "All clear." }).waitFor();
    await page
      .getByText("Today's sorting limit is reached. It resets at 01:00.")
      .waitFor();
    expect(await line(page).count()).toBe(1);
  });

  it("is gone once the limit resets, with an idle poll and no reload", async () => {
    const lastMinute = new Date(Date.parse(resets) - minute);
    view = await open(
      capped([ask("a", "shop", new Date(Date.parse(resets) + 10 * minute))]),
      lastMinute,
      phone,
      "Europe/London",
    );
    const { page } = view;
    await page.getByText("Today's sorting limit is reached.").waitFor();
    await page.clock.fastForward(minute + pollMs);
    await page.getByText("Sorting 1 ask with your rules").waitFor();
    expect(await page.getByText("sorting limit is reached").count()).toBe(0);
    const polls = view.apiCalls.filter(({ path }) => path === pagePaths.asks);
    expect(polls.length).toBeGreaterThan(1);
    expect(polls.slice(1).every(({ query }) => query === "?since=3")).toBe(
      true,
    );
  });
});

describe("the sorting line on All clear", () => {
  // Held by work's hours, and lapsed, and both stopped, so the list is all
  // clear with the held, lapsed and sorting lines at its foot.
  const held = ask("a", "work", earlier);
  const lapsed = {
    ...ask("b", "shop", earlier),
    lapsesAt: earlier.toISOString(),
  };
  const stopped = "2 asks couldn't be sorted. Saving your rules tries again.";
  // A line's box, the held line's or the sorting line's, found by its words.
  const box = (page: Page, words: string) =>
    page.getByText(words, { exact: true }).locator("..").boundingBox();

  it("sits at the foot, under the held and lapsed lines", async () => {
    view = await open(listOf([held, lapsed]));
    const { page } = view;
    await page.getByRole("heading", { name: "All clear." }).waitFor();
    await page.getByText(stopped).waitFor();
    expect(
      await page.getByRole("navigation", { name: "Hashtags" }).count(),
    ).toBe(0);
    expect(await line(page).count()).toBe(1);
    const heldBox = await box(page, "1 held until its hours");
    const lapsedBox = await box(page, "1 has lapsed");
    const sortingBox = await box(page, stopped);
    expect(lapsedBox?.y).toBeCloseTo(
      (heldBox?.y ?? 0) + (heldBox?.height ?? 0),
      0,
    );
    expect(sortingBox?.y).toBeCloseTo(
      (lapsedBox?.y ?? 0) + (lapsedBox?.height ?? 0),
      0,
    );
    expect((sortingBox?.y ?? 0) + (sortingBox?.height ?? 0)).toBeGreaterThan(
      phone.height - 60,
    );
  });

  it("leaves All clear a third of the way down the space above the first line at the foot", async () => {
    view = await open(listOf([held, lapsed]));
    const { page } = view;
    await page.getByText(stopped).waitFor();
    const { above, below } = await allClearGaps(page, "1 held until its hours");
    expect(Math.abs(above - below / 2)).toBeLessThanOrEqual(4);
  });

  it("goes back under the tabs, below the held and lapsed lines, when Show them brings the list back", async () => {
    view = await open(listOf([held, lapsed]));
    const { page } = view;
    await page.getByText(stopped).waitFor();
    await page.getByRole("button", { name: "Show them" }).first().click();
    await page.getByRole("navigation", { name: "Hashtags" }).waitFor();
    expect(await line(page).count()).toBe(1);
    const sortingBox = await box(page, stopped);
    for (const above of ["Showing 1 held ask", "1 has lapsed"]) {
      const aboveBox = await box(page, above);
      expect(sortingBox?.y, above).toBeGreaterThanOrEqual(
        (aboveBox?.y ?? Infinity) + (aboveBox?.height ?? 0) - 1,
      );
    }
    const card = await page.getByRole("article").boundingBox();
    expect(card?.y).toBeGreaterThan(
      (sortingBox?.y ?? Infinity) + (sortingBox?.height ?? 0) - 1,
    );
  });

  // The one ask showing is dismissed, with the page's time standing still,
  // so the note with Undo stays. Some screens are too short to hold the
  // headline where it is, and some too short for All clear at all, so the
  // page scrolls.
  it.each([
    ["390 by 844", phone],
    ["360 by 640", { width: 360, height: 640 }],
    ["360 by 480", { width: 360, height: 480 }],
  ])(
    "moves up out of the note's way with the held and lapsed lines, on a %s screen",
    async (_, screen) => {
      const showing = "Ask c";
      view = await open(
        listOf([held, lapsed, ask("c", "shop")]),
        evening,
        screen,
      );
      const { page } = view;
      await page.getByRole("link", { name: showing }).waitFor();
      await page.clock.pauseAt(new Date(evening.getTime() + minute));
      await page.getByRole("link", { name: showing }).click();
      await page.getByRole("button", { name: "Dismiss" }).click();
      await page.getByRole("heading", { name: "All clear." }).waitFor();
      await page.getByRole("button", { name: "Undo" }).waitFor();
      const { last, foot, note } = await underTheNote(page, stopped);
      expect(last).toBeLessThanOrEqual(note);
      expect(foot).toBeLessThanOrEqual(note);
      // The lines move up, but not over All clear's last line.
      expect(
        (await allClearGaps(page, "1 held until its hours")).below,
      ).toBeGreaterThan(0);
    },
  );
});

describe("fitness: stopped is worked out, not written (sort-queue.md)", () => {
  it("shows an ask as stopped once its time passes, with an idle poll and no reload", async () => {
    const turns = new Date(evening.getTime() + minute);
    view = await open(listOf([ask("a", "shop", turns)]));
    const { page } = view;
    await page.getByText("Sorting 1 ask with your rules").waitFor();
    await page.clock.fastForward(minute + pollMs);
    await page
      .getByText("1 ask couldn't be sorted. Saving your rules tries again.")
      .waitFor();
    // Every poll after the first was answered as unchanged.
    const polls = view.apiCalls.filter(({ path }) => path === pagePaths.asks);
    expect(polls.length).toBeGreaterThan(1);
    expect(polls.slice(1).every(({ query }) => query === "?since=3")).toBe(
      true,
    );
  });
});
