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
  datedPolls,
  failingPolls,
  moveDeviceClock,
  openPage,
  Status,
  stepUntil,
  stepUntilShown,
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
      "Book the boiler service?",
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
const boiler = "Book the boiler service?";

// Opens the list on a page whose clock stands still two minutes before a
// moment by the service's clock, which is serviceAhead ahead of the page's,
// and waits for the summaries on the screen to read `before`, in order. A
// second before the moment, by the page's clock, a poll brings a new ask,
// which goes last, and the rest still read `before`. The first poll after
// the moment finds them reading `after`. Each poll's answer gives the
// service's time in its Date header, as it is then, because the page's
// clock moves only when the test moves it.
async function orderChangesAt(
  moment: number,
  serviceAhead: number,
  asks: PageAsk[],
  before: string[],
  after: string[],
): Promise<Page> {
  const here = moment - serviceAhead;
  let pageAt = here - 2 * minute;
  let answer = listOf(...asks);
  view = await openPage(inject("pageUrl"), phone, {
    session,
    clock: { stoppedAt: new Date(pageAt) },
    api: {
      [pagePaths.asks]: datedPolls(
        () => answer,
        () => pageAt + serviceAhead,
      ),
    },
  });
  const { page } = view;
  const reads = (order: string[]) => async () =>
    (await summaries(page)).join("\n") === order.join("\n");
  await stepUntil(page, reads(before), "the list to read as before");
  answer = {
    ...listOf(...asks, ask("z", boiler, family("low"))),
    version: 4,
  };
  pageAt = here - 1000;
  await page.clock.pauseAt(new Date(pageAt));
  await stepUntil(page, reads([...before, boiler]), "the new ask to show");
  pageAt = here + pollMs;
  await page.clock.pauseAt(new Date(pageAt));
  await stepUntil(page, reads([...after, boiler]), "the list to read as after");
  return page;
}

// Opens the list on a page whose clock stands still two minutes before a
// moment by the service's clock, which is serviceAhead ahead of the page's,
// and waits for the summaries on the screen to read `before`, in order. Then
// every poll fails from the next one on, and before it the device puts its
// clock right, so it agrees with the service's. Once the page says it is not
// connected, the summaries still read `before`. The first poll after the
// moment, by the service's clock, finds them reading `after`, though it fails
// too.
async function orderChangesAtWhilePollsFail(
  moment: number,
  serviceAhead: number,
  asks: PageAsk[],
  before: string[],
  after: string[],
): Promise<Page> {
  const pageAt = moment - serviceAhead - 2 * minute;
  const polls = failingPolls(
    () => listOf(...asks),
    () => pageAt + serviceAhead,
  );
  view = await openPage(inject("pageUrl"), phone, {
    session,
    clock: { stoppedAt: new Date(pageAt) },
    api: { [pagePaths.asks]: polls.answering },
  });
  const { page } = view;
  const reads = (order: string[]) => async () =>
    (await summaries(page)).join("\n") === order.join("\n");
  await stepUntil(page, reads(before), "the list to read as before");
  polls.fail();
  await moveDeviceClock(page, serviceAhead);
  await page.clock.pauseAt(new Date(moment - 2 * minute + pollMs + 1000));
  await stepUntilShown(page, page.getByText("Not connected. Trying again."));
  expect(await summaries(page)).toEqual(before);
  await page.clock.pauseAt(new Date(moment + pollMs));
  await stepUntil(page, reads(after), "the list to read as after");
  return page;
}

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

  // The service gives the time an ask lapses by its own clock, so the ask
  // moves up when the service's time for its last hour comes, even on a page
  // whose clock is a few minutes out. For an ask whose last hour starts at
  // 18:01 UTC by the service's clock, a clock three minutes fast reads 18:04
  // then, and one three minutes slow reads 17:58.
  it.each([
    ["fast", -3 * minute],
    ["slow", 3 * minute],
  ])(
    "moves an ask to the top when the service's time for its last hour comes, on a clock a few minutes %s",
    async (_, serviceAhead) => {
      await orderChangesAt(
        evening.getTime() + minute,
        serviceAhead,
        [
          ask("a", schoolRun, family("high")),
          ask("b", slot, family("low"), 61 * minute),
        ],
        [schoolRun, slot],
        [slot, schoolRun],
      );
    },
  );
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

  // The service gives the time an ask lapses by its own clock, so the ask
  // goes behind the line when the service's time for it comes, even on a
  // page whose clock is a few minutes out. For an ask that lapses at 18:20
  // UTC by the service's clock, a clock three minutes fast reads 18:23 then,
  // and one three minutes slow reads 18:17.
  it.each([
    ["fast", -3 * minute],
    ["slow", 3 * minute],
  ])(
    "takes an ask out of the list, behind the line, when the service's time for it comes, on a clock a few minutes %s",
    async (_, serviceAhead) => {
      const page = await orderChangesAt(
        evening.getTime() + 20 * minute,
        serviceAhead,
        [
          ask("a", schoolRun, family("low")),
          ask("b", passkey, shop("high"), 20 * minute),
        ],
        [passkey, schoolRun],
        [schoolRun],
      );
      expect(await underTheTabs(page)).toBe("1 has lapsedShow them");
    },
  );

  // While polls fail, the page counts the service's time on from the last
  // poll that reached askme, by the time that has passed on
  // performance.now(), which a change to the device's clock does not move.
  // So a clock three minutes fast or slow, put right while the page is not
  // connected, does not make the ask lapse three minutes early or late.
  it.each([
    ["fast", -3 * minute],
    ["slow", 3 * minute],
  ])(
    "takes an ask out of the list when the service's time for it comes, though a clock a few minutes %s is put right while polls fail",
    async (_, serviceAhead) => {
      const page = await orderChangesAtWhilePollsFail(
        evening.getTime() + 20 * minute,
        serviceAhead,
        [
          ask("a", schoolRun, family("low")),
          ask("b", passkey, shop("high"), 20 * minute),
        ],
        [passkey, schoolRun],
        [schoolRun],
      );
      expect(await underTheTabs(page)).toBe("1 has lapsedShow them");
    },
  );

  // A phone or laptop that sleeps usually hides the page first, and on most
  // systems performance.now() stands still while it sleeps. So the time the
  // page was hidden counts by the device's clock, and an ask whose time passed
  // while the device slept has lapsed when the page is shown, though the poll
  // then fails.
  it("takes an ask out of the list whose time passed while the page was hidden and the device slept, though the poll on waking fails", async () => {
    const polls = failingPolls(
      () =>
        listOf(
          ask("a", schoolRun, family("low")),
          ask("b", passkey, shop("high"), 20 * minute),
        ),
      () => evening.getTime(),
    );
    view = await openPage(inject("pageUrl"), phone, {
      session,
      clock: { stoppedAt: evening },
      api: { [pagePaths.asks]: polls.answering },
    });
    const { page } = view;
    await stepUntil(
      page,
      async () =>
        (await summaries(page)).join("\n") === `${passkey}\n${schoolRun}`,
      "the list to show",
    );
    polls.fail();
    await view.hide();
    await moveDeviceClock(page, 60 * minute);
    await view.show();
    await stepUntilShown(page, page.getByText("Not connected. Trying again."));
    expect(await summaries(page)).toEqual([schoolRun]);
    expect(await underTheTabs(page)).toBe("1 has lapsedShow them");
  });

  // A device can sleep without hiding the page, such as a desktop that
  // suspends with no screen lock. Its clock moves on an hour, with
  // performance.now() standing still, which is more than a device putting
  // its clock right is likely to move it. So the page counts that hour by the
  // device's clock, and an ask whose time passed while the device slept has
  // lapsed on the first poll after it wakes, though that poll fails.
  it("takes an ask out of the list whose time passed while the device slept with the page showing, though the poll on waking fails", async () => {
    const polls = failingPolls(
      () =>
        listOf(
          ask("a", schoolRun, family("low")),
          ask("b", passkey, shop("high"), 20 * minute),
        ),
      () => evening.getTime(),
    );
    view = await openPage(inject("pageUrl"), phone, {
      session,
      clock: { stoppedAt: evening },
      api: { [pagePaths.asks]: polls.answering },
    });
    const { page } = view;
    await stepUntil(
      page,
      async () =>
        (await summaries(page)).join("\n") === `${passkey}\n${schoolRun}`,
      "the list to show",
    );
    polls.fail();
    await moveDeviceClock(page, 60 * minute);
    await page.clock.fastForward(pollMs);
    await stepUntilShown(page, page.getByText("Not connected. Trying again."));
    expect(await summaries(page)).toEqual([schoolRun]);
    expect(await underTheTabs(page)).toBe("1 has lapsedShow them");
  });

  // Leaving the list for the rules and coming back, with the page visible
  // throughout, is no reason to stop counting by performance.now().
  it("takes an ask out of the list when the service's time for it comes, though a slow clock is put right while polls fail and the person goes to the rules and back", async () => {
    const moment = evening.getTime() + 20 * minute;
    const serviceAhead = 3 * minute;
    const pageAt = moment - serviceAhead - 2 * minute;
    const polls = failingPolls(
      () =>
        listOf(
          ask("a", schoolRun, family("low")),
          ask("b", passkey, shop("high"), 20 * minute),
        ),
      () => pageAt + serviceAhead,
    );
    view = await openPage(inject("pageUrl"), phone, {
      session,
      clock: { stoppedAt: new Date(pageAt) },
      api: { [pagePaths.asks]: polls.answering },
    });
    const { page } = view;
    const reads = (order: string[]) => async () =>
      (await summaries(page)).join("\n") === order.join("\n");
    await stepUntil(page, reads([passkey, schoolRun]), "the list to show");
    polls.fail();
    await moveDeviceClock(page, serviceAhead);
    await page.getByRole("link", { name: "Rules" }).click();
    await stepUntilShown(
      page,
      page.getByRole("heading", { name: "Your rules", exact: true }),
    );
    await page.goBack();
    await page.clock.pauseAt(new Date(moment - 2 * minute + pollMs + 1000));
    await stepUntilShown(page, page.getByText("Not connected. Trying again."));
    expect(await summaries(page)).toEqual([passkey, schoolRun]);
    await page.clock.pauseAt(new Date(moment + pollMs));
    await stepUntil(page, reads([schoolRun]), "the ask to lapse");
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
