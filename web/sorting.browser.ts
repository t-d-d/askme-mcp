// The sorting line (docs/design.md, "The sorting line"), with Clerk and the
// page's API faked on loopback (ADR 9). The page's clock is set, so each
// test knows which asks are still being sorted.
import { afterEach, describe, expect, inject, it } from "vitest";
import { pagePaths, type AsksAnswer, type Hashtag } from "../shared/page-api";
import {
  answerPoll,
  Answering,
  computedColour,
  openPage,
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

const open = (list: AsksAnswer, time = evening, timeZone?: string) =>
  openPage(inject("pageUrl"), phone, {
    session,
    clock: time,
    ...(timeZone === undefined ? {} : { timeZone }),
    api: { [pagePaths.asks]: new Answering((url) => answerPoll(url, list)) },
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
      "Europe/London",
    );
    const { page } = view;
    await page
      .getByText("Today's sorting limit is reached. It resets at 01:00.")
      .waitFor();
    expect(await line(page).count()).toBe(1);
  });

  it("gives the time the limit resets on the clock where the person is", async () => {
    view = await open(capped([ask("a", "shop")]), evening, "America/New_York");
    await view.page
      .getByText("Today's sorting limit is reached. It resets at 20:00.")
      .waitFor();
  });

  it("is gone once the limit resets, with an idle poll and no reload", async () => {
    const lastMinute = new Date(Date.parse(resets) - minute);
    view = await open(
      capped([ask("a", "shop", new Date(Date.parse(resets) + 10 * minute))]),
      lastMinute,
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
