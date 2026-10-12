// The page polls for changes while it is visible, and only then (ADR 1).
// The page's API is faked on loopback, and the page runs on Playwright's
// clock, so a test moves time on by a poll interval instead of waiting.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  pagePaths,
  sinceParam,
  type AsksAnswer,
  type PageAsk,
} from "../shared/page-api";
import {
  Answering,
  answerPoll,
  openPage,
  type OpenPage,
} from "../test/browser";
import { pollMs } from "../web/src/poll";

const phone = { width: 390, height: 844 };

const ask = (id: string, summary: string): PageAsk => ({
  id,
  summary,
  spokenDetail: `The spoken detail of ${summary}`,
  postedAt: new Date().toISOString(),
  opened: false,
  sort: null,
});

const first = ask("a", "Merge the fix for checkout rounding? Tests pass.");
const second = ask("b", "Which date format should the export use?");

// A list the test can change. A poll carrying its version is answered with
// nothing new, as the service answers it.
function fakeList(list: AsksAnswer) {
  let current = list;
  return {
    set(next: AsksAnswer) {
      current = next;
    },
    answering: new Answering((url) => answerPoll(url, current)),
  };
}

const open = (list: ReturnType<typeof fakeList>) =>
  openPage(inject("pageUrl"), phone, {
    session: "test-session-token",
    clock: true,
    api: { [pagePaths.asks]: list.answering },
  });

const polls = (view: OpenPage) =>
  view.apiCalls.filter((call) => call.path === pagePaths.asks);

// Lets any request the page started reach the fake API.
const settle = (view: OpenPage) => view.page.waitForTimeout(250);

describe("fitness: new ask appears (polling.md)", () => {
  let view: OpenPage;
  const list = fakeList({
    version: 1,
    everAsked: true,
    hashtags: [],
    formerHashtags: [],
    asks: [first],
  });
  beforeAll(async () => {
    view = await open(list);
    await view.page.getByRole("article").waitFor();
    // A reload would lose this mark.
    await view.page.evaluate(() => {
      document.documentElement.dataset.mark = "first load";
    });
  });
  afterAll(async () => {
    await view.close();
  });

  it("shows a new ask within two poll intervals, with no reload", async () => {
    list.set({
      version: 2,
      everAsked: true,
      hashtags: [],
      formerHashtags: [],
      asks: [first, second],
    });
    await view.page.clock.fastForward(pollMs);
    await view.page.clock.fastForward(pollMs);
    await view.page
      .getByRole("listitem")
      .filter({ hasText: second.summary })
      .waitFor({ timeout: 2000 });
    expect(
      await view.page.evaluate(() => document.documentElement.dataset.mark),
    ).toBe("first load");
  });

  it("carries the version of the list it has on each poll", () => {
    const [load, ...later] = polls(view);
    expect(load?.query).toBe("");
    expect(later.length).toBeGreaterThan(0);
    expect(later[0]?.query).toBe(`?${sinceParam}=1`);
    expect(later.at(-1)?.query).toMatch(/^\?since=[12]$/u);
  });
});

describe("fitness: quiet when hidden (polling.md)", () => {
  let view: OpenPage;
  const list = fakeList({
    version: 1,
    everAsked: true,
    hashtags: [],
    formerHashtags: [],
    asks: [first],
  });
  beforeAll(async () => {
    view = await open(list);
    await view.page.getByRole("article").waitFor();
  });
  afterAll(async () => {
    await view.close();
  });

  it("polls while the page is visible", async () => {
    const before = polls(view).length;
    await view.page.clock.fastForward(pollMs);
    await settle(view);
    expect(polls(view).length).toBe(before + 1);
  });

  it("sends no poll while the page is hidden", async () => {
    await view.hide();
    await settle(view);
    const before = polls(view).length;
    for (let interval = 0; interval < 4; interval += 1) {
      await view.page.clock.fastForward(pollMs);
    }
    await settle(view);
    expect(polls(view).length).toBe(before);
  });

  it("polls once when it becomes visible again", async () => {
    const before = polls(view).length;
    await view.show();
    await expect.poll(() => polls(view).length).toBe(before + 1);
    await settle(view);
    expect(polls(view).length).toBe(before + 1);
    expect(polls(view).at(-1)?.query).toBe(`?${sinceParam}=1`);
  });
});

describe("a poll after another screen", () => {
  let view: OpenPage;
  const list = fakeList({
    version: 1,
    everAsked: true,
    hashtags: [],
    formerHashtags: [],
    asks: [first],
  });
  beforeAll(async () => {
    view = await open(list);
    await view.page.getByRole("article").waitFor();
  });
  afterAll(async () => {
    await view.close();
  });

  it("carries the version of the list the page already has", async () => {
    await view.page.evaluate(() => {
      window.location.hash = "#connect";
    });
    await view.page.getByRole("article").waitFor({ state: "detached" });
    const before = polls(view).length;
    await view.page.evaluate(() => {
      window.location.hash = "";
    });
    await view.page.getByRole("article").waitFor();
    await expect.poll(() => polls(view).length).toBeGreaterThan(before);
    expect(polls(view)[before]?.query).toBe(`?${sinceParam}=1`);
  });
});
