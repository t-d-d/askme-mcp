// Ordering asks by the time they lapse, and holding lapsed asks back behind
// a line of their own (PRD, "Web page"), with Clerk and the page's API faked
// on loopback (ADR 9). The page's clock is set, so each test knows which
// asks lapse when.
import { afterEach, describe, expect, inject, it } from "vitest";
import {
  askChange,
  askChangePaths,
  pagePaths,
  type AsksAnswer,
  type Hashtag,
  type Level,
  type PageAsk,
} from "../shared/page-api";
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

// An ask posted half an hour before the time given, which lapses the given
// time after it, or never.
const ask = (
  id: string,
  summary: string,
  sort: { hashtags: string[]; level: Level },
  lapsesIn?: number,
): PageAsk => ({
  id,
  summary,
  spokenDetail: `The spoken detail of ${summary}`,
  postedAt: new Date(evening.getTime() - 30 * minute).toISOString(),
  ...(lapsesIn === undefined
    ? {}
    : { lapsesAt: new Date(evening.getTime() + lapsesIn).toISOString() }),
  opened: false,
  sort: { ...sort, reason: "Sorted for the test." },
});

const shop = (level: Level) => ({ hashtags: ["shop"], level });
const work = (level: Level) => ({ hashtags: ["work"], level });
const family = (level: Level) => ({ hashtags: ["family"], level });

const listOf = (...asks: PageAsk[]): AsksAnswer => ({
  version: 3,
  everAsked: true,
  hashtags,
  formerHashtags: [],
  timeZone: "Europe/London",
  asks,
});

let view: OpenPage | undefined;
afterEach(async () => {
  await view?.close();
  view = undefined;
});

// The list, polled as the service answers: whole the first time, and as
// unchanged after that. The API takes a dismissal. The test can change what
// the service answers from then on.
const open = async (list: AsksAnswer, screen = phone) => {
  let answer = list;
  view = await openPage(inject("pageUrl"), screen, {
    session,
    clock: evening,
    api: {
      [pagePaths.asks]: new Answering((url) => answerPoll(url, answer)),
      [askChangePaths.dismissed]: new Status(204),
    },
  });
  return {
    ...view,
    answerWith: (next: AsksAnswer) => {
      answer = next;
    },
  };
};

// The summaries on the screen, in order: the top card's, then the rows'.
const summaries = async (page: Page) =>
  [
    ...(await page.getByRole("article").allInnerTexts()),
    ...(await page.getByRole("listitem").allInnerTexts()),
  ].map((text) => {
    const found = [
      "Merge the fix for checkout rounding?",
      "Which date format should the export use?",
      "Swap Saturday's school run?",
      "Renew the shop's domain?",
      "Approve the passkey on the shop's settings page?",
      "Pick a delivery slot before it goes?",
    ].find((summary) => text.includes(summary));
    return found ?? text;
  });

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

// A line's control, found by the line's words.
const control = (page: Page, words: string | RegExp) =>
  page.getByText(words).locator("..").getByRole("button");

// Whether a control has the keyboard's focus.
const focused = (element: Locator) =>
  element.evaluate((one) => one === document.activeElement);

const merge = "Merge the fix for checkout rounding?";
const format = "Which date format should the export use?";
const schoolRun = "Swap Saturday's school run?";
const domain = "Renew the shop's domain?";
const passkey = "Approve the passkey on the shop's settings page?";
const slot = "Pick a delivery slot before it goes?";

describe("ordering by the time asks lapse", () => {
  it("puts an ask that lapses within the hour first, above every level", async () => {
    const { page } = await open(
      listOf(
        ask("a", schoolRun, family("high")),
        ask("b", domain, shop("low")),
        ask("c", passkey, shop("low"), 20 * minute),
      ),
    );
    await page.getByRole("article").waitFor();
    expect(await summaries(page)).toEqual([passkey, schoolRun, domain]);
  });

  it("moves an ask to the top as its last hour comes, with no reload", async () => {
    const { page } = await open(
      listOf(
        ask("a", schoolRun, family("high")),
        ask("b", slot, family("low"), 61 * minute),
      ),
    );
    await page.getByRole("article").waitFor();
    expect(await summaries(page)).toEqual([schoolRun, slot]);
    await page.clock.fastForward(minute + pollMs);
    await page.getByRole("article").filter({ hasText: slot }).waitFor();
    expect(await summaries(page)).toEqual([slot, schoolRun]);
  });
});

describe("the lapsed line", () => {
  it("leaves an ask whose time has passed out of the list, and says how many have lapsed under the tabs", async () => {
    const { page } = await open(
      listOf(
        ask("a", schoolRun, family("normal")),
        ask("b", passkey, shop("high"), -minute),
        ask("c", slot, family("high"), -20 * minute),
      ),
    );
    await page.getByRole("article").waitFor();
    expect(await summaries(page)).toEqual([schoolRun]);
    expect(await underTheTabs(page)).toBe("2 have lapsedShow them");
    const box = await control(page, "2 have lapsed").boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  });

  it("shows the lapsed asks after Show them, below every other, says how many are showing, and hides them again", async () => {
    const { page } = await open(
      listOf(
        ask("a", passkey, shop("high"), -minute),
        ask("b", schoolRun, family("low")),
        ask("c", slot, family("normal"), -20 * minute),
      ),
    );
    await page.getByRole("button", { name: "Show them" }).click();
    await page.getByText("Showing 2 lapsed asks").waitFor();
    expect(await summaries(page)).toEqual([schoolRun, passkey, slot]);
    await page.getByRole("button", { name: "Hide them" }).click();
    await page.getByText("2 have lapsed").waitFor();
    expect(await summaries(page)).toEqual([schoolRun]);
  });

  it("says one has lapsed, and shows it", async () => {
    const { page } = await open(
      listOf(
        ask("a", schoolRun, family("normal")),
        ask("b", passkey, shop("high"), -minute),
      ),
    );
    await page.getByText("1 has lapsed").waitFor();
    await page.getByRole("button", { name: "Show them" }).click();
    await page.getByText("Showing 1 lapsed ask").waitFor();
    expect(await summaries(page)).toEqual([schoolRun, passkey]);
  });

  it("is not there when nothing has lapsed", async () => {
    const { page } = await open(
      listOf(
        ask("a", schoolRun, family("normal")),
        ask("b", passkey, shop("high"), minute),
      ),
    );
    await page.getByRole("article").waitFor();
    expect(await page.getByText(/lapsed/u).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Show them" }).count()).toBe(
      0,
    );
  });

  it("works the same on every tab, and is not there on one with nothing lapsed", async () => {
    const { page } = await open(
      listOf(
        ask("a", schoolRun, family("normal")),
        ask("b", domain, shop("low")),
        ask("c", passkey, shop("high"), -minute),
      ),
    );
    await page.getByRole("article").waitFor();
    await tab(page, "#shop").click();
    await page.getByRole("article").filter({ hasText: domain }).waitFor();
    expect(await underTheTabs(page)).toBe("1 has lapsedShow them");
    await tab(page, "#family").click();
    await page.getByRole("article").filter({ hasText: schoolRun }).waitFor();
    expect(await page.getByText(/lapsed/u).count()).toBe(0);
  });

  it("sits under the held line, and each line shows only its own asks", async () => {
    const { page } = await open(
      listOf(
        ask("a", schoolRun, family("normal")),
        ask("b", format, work("normal")),
        ask("c", passkey, shop("high"), -minute),
      ),
    );
    await page.getByRole("article").waitFor();
    expect(await underTheTabs(page)).toBe(
      "1 held until its hoursShow them1 has lapsedShow them",
    );
    await control(page, "1 has lapsed").click();
    await page.getByText("Showing 1 lapsed ask").waitFor();
    expect(await summaries(page)).toEqual([schoolRun, passkey]);
    await control(page, "1 held until its hours").click();
    await page.getByText("Showing 1 held ask").waitFor();
    expect(await summaries(page)).toEqual([schoolRun, format, passkey]);
  });

  it("keeps an ask outside its hours held though it lapses within the hour, and counts it as lapsed once its time has passed", async () => {
    const { page } = await open(
      listOf(
        ask("a", schoolRun, family("low")),
        ask("b", merge, work("low"), 20 * minute),
      ),
    );
    await page.getByText("1 held until its hours").waitFor();
    expect(await summaries(page)).toEqual([schoolRun]);
    expect(await page.getByText(/lapsed/u).count()).toBe(0);
    await page.clock.fastForward(20 * minute + pollMs);
    await page.getByText("1 has lapsed").waitFor();
    expect(await page.getByText(/held/u).count()).toBe(0);
    expect(await summaries(page)).toEqual([schoolRun]);
  });

  it("takes an ask out of the list as its time passes, with no reload", async () => {
    const { page } = await open(
      listOf(
        ask("a", schoolRun, family("low")),
        ask("b", passkey, shop("high"), minute),
      ),
    );
    await page.getByRole("article").filter({ hasText: passkey }).waitFor();
    await page.clock.fastForward(minute + pollMs);
    await page.getByText("1 has lapsed").waitFor();
    expect(await summaries(page)).toEqual([schoolRun]);
  });

  it("sits at the foot of All clear when every ask has lapsed, and Show them brings the tabs back", async () => {
    const { page } = await open(
      listOf(ask("a", passkey, shop("high"), -minute)),
    );
    await page.getByRole("heading", { name: "All clear." }).waitFor();
    expect(
      await page.getByRole("navigation", { name: "Hashtags" }).count(),
    ).toBe(0);
    const line = page.getByText("1 has lapsed");
    const foot = await line.boundingBox();
    expect((foot?.y ?? 0) + (foot?.height ?? 0)).toBeGreaterThan(
      phone.height - 120,
    );
    await page.getByRole("button", { name: "Show them" }).click();
    await page.getByRole("navigation", { name: "Hashtags" }).waitFor();
    expect(await underTheTabs(page)).toBe("Showing 1 lapsed askHide them");
    expect(await summaries(page)).toEqual([passkey]);
  });

  it("leaves All clear a third of the way down the space above it", async () => {
    const { page } = await open(
      listOf(ask("a", passkey, shop("high"), -minute)),
    );
    await page.getByText("1 has lapsed").waitFor();
    const { above, below } = await allClearGaps(page, "1 has lapsed");
    expect(Math.abs(above - below / 2)).toBeLessThanOrEqual(4);
  });

  it("sits under the held line at the foot of All clear, with All clear a third of the way down the space above both", async () => {
    const { page } = await open(
      listOf(
        ask("a", format, work("normal")),
        ask("b", passkey, shop("high"), -minute),
      ),
    );
    await page.getByRole("heading", { name: "All clear." }).waitFor();
    const held = await page
      .getByText("1 held until its hours")
      .locator("..")
      .boundingBox();
    const lapsed = await page
      .getByText("1 has lapsed")
      .locator("..")
      .boundingBox();
    expect(lapsed?.y).toBeCloseTo((held?.y ?? 0) + (held?.height ?? 0), 0);
    expect((lapsed?.y ?? 0) + (lapsed?.height ?? 0)).toBeGreaterThan(
      phone.height - 120,
    );
    const { above, below } = await allClearGaps(page, "1 held until its hours");
    expect(Math.abs(above - below / 2)).toBeLessThanOrEqual(4);
  });

  it("keeps both lines at the foot of All clear clear of the note after a dismissal", async () => {
    const { page } = await open(
      listOf(
        ask("a", schoolRun, family("normal")),
        ask("b", format, work("normal")),
        ask("c", passkey, shop("high"), -minute),
      ),
    );
    await page.getByRole("link", { name: schoolRun }).waitFor();
    // The page's time stands still, so the note with Undo stays.
    await page.clock.pauseAt(new Date(evening.getTime() + minute));
    await page.getByRole("link", { name: schoolRun }).click();
    await page.getByRole("button", { name: "Dismiss" }).click();
    await page.getByRole("heading", { name: "All clear." }).waitFor();
    await page.getByRole("button", { name: "Undo" }).waitFor();
    for (const height of [844, 560]) {
      await page.setViewportSize({ width: phone.width, height });
      const { last, foot, note } = await underTheNote(page, "1 has lapsed");
      expect(last).toBeLessThanOrEqual(note);
      expect(foot).toBeLessThanOrEqual(note);
    }
  });

  it("lets a lapsed ask be opened and dismissed, which does not close it until the person says", async () => {
    const opened = await open(
      listOf(
        ask("a", schoolRun, family("low")),
        ask("b", passkey, shop("high"), -minute),
      ),
    );
    const { page, apiCalls } = opened;
    await page.getByRole("button", { name: "Show them" }).click();
    await page.getByRole("link", { name: passkey }).click();
    await page.getByRole("link", { name: "All asks" }).waitFor();
    expect(await page.getByRole("heading", { name: passkey }).count()).toBe(1);
    await page.getByRole("button", { name: "Dismiss" }).click();
    await page.getByRole("button", { name: "Undo" }).waitFor();
    await page.clock.fastForward(undoMs + 500);
    await expect
      .poll(() =>
        apiCalls
          .filter(({ path }) => path === askChangePaths.dismissed)
          .map(({ body }) => askChange.parse(JSON.parse(body ?? "")).id),
      )
      .toEqual(["b"]);
  });

  it("keeps focus on its control when Show them at the foot of All clear brings the tabs back", async () => {
    const { page } = await open(
      listOf(ask("a", passkey, shop("high"), -minute)),
    );
    await page.getByRole("heading", { name: "All clear." }).waitFor();
    await page.getByRole("button", { name: "Show them" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("navigation", { name: "Hashtags" }).waitFor();
    expect(await focused(page.getByRole("button", { name: "Hide them" }))).toBe(
      true,
    );
  });

  it("moves focus to the selected tab when it goes at a poll with focus, and the tabs stay", async () => {
    const list = listOf(
      ask("a", schoolRun, family("low")),
      ask("b", passkey, shop("high"), -minute),
    );
    const opened = await open(list);
    const { page } = opened;
    await page.getByRole("button", { name: "Show them" }).focus();
    // The agent resolves the lapsed ask, so askme drops it.
    opened.answerWith({
      ...list,
      version: list.version + 1,
      asks: list.asks.slice(0, 1),
    });
    await page.clock.fastForward(pollMs);
    await page.getByText(/lapsed/u).waitFor({ state: "detached" });
    expect(await focused(tab(page, "Everything"))).toBe(true);
  });

  it("moves focus to All clear when it goes at a poll with focus at the foot of All clear", async () => {
    const list = listOf(ask("a", passkey, shop("high"), -minute));
    const opened = await open(list);
    const { page } = opened;
    await page.getByRole("heading", { name: "All clear." }).waitFor();
    await page.getByRole("button", { name: "Show them" }).focus();
    opened.answerWith({ ...list, version: list.version + 1, asks: [] });
    await page.clock.fastForward(pollMs);
    await page.getByText(/lapsed/u).waitFor({ state: "detached" });
    expect(
      await focused(page.getByRole("heading", { name: "All clear." })),
    ).toBe(true);
  });

  it("keeps focus on its control when an ask lapses and the line moves to the foot of All clear", async () => {
    const { page } = await open(
      listOf(
        ask("a", format, work("normal")),
        ask("b", passkey, shop("high"), minute),
      ),
    );
    await page.getByRole("article").filter({ hasText: passkey }).waitFor();
    const show = control(page, "1 held until its hours");
    await show.focus();
    await page.clock.fastForward(minute + pollMs);
    await page.getByRole("heading", { name: "All clear." }).waitFor();
    await page.getByText("1 has lapsed").waitFor();
    expect(await focused(control(page, "1 held until its hours"))).toBe(true);
  });
});
