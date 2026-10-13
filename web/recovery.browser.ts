import { afterEach, describe, expect, inject, it } from "vitest";
import { pagePaths, type AsksAnswer } from "../shared/page-api";
import {
  Answering,
  answerPoll,
  openPage,
  type OpenPage,
} from "../test/browser";
import { pollMs } from "./src/poll";
import { signInWaitMs } from "./src/reload";

const phone = { width: 390, height: 844 };
const session = "test-session-token";
const minute = 60_000;

const ask = (
  id: string,
  summary: string,
  postedAt: Date,
  hashtag: string,
): AsksAnswer["asks"][number] => ({
  id,
  summary,
  spokenDetail: `The spoken detail of ${summary}`,
  postedAt: new Date(postedAt.getTime() - 30 * minute).toISOString(),
  opened: false,
  sort: {
    hashtags: [hashtag],
    level: "normal",
    reason: "Sorted for the test.",
  },
});

const listAt = (time: Date): AsksAnswer => ({
  version: 3,
  everAsked: true,
  hashtags: [
    { name: "shop", colour: 1 },
    {
      name: "work",
      colour: 0,
      hours: [
        {
          days: ["mon", "tue", "wed", "thu", "fri"],
          from: "08:00",
          to: "18:00",
        },
      ],
    },
  ],
  formerHashtags: [],
  timeZone: "Europe/London",
  asks: [
    ask("a", "Which date format should the export use?", time, "work"),
    ask("b", "Renew the shop's domain?", time, "shop"),
  ],
});

const notConnected = "Not connected. Trying again.";

let view: OpenPage | undefined;
afterEach(async () => {
  await view?.close();
  view = undefined;
});

describe("a browser that goes offline", () => {
  it("says the page is not connected within one poll, and lets a held ask go at its hours", async () => {
    // Tuesday, a minute before work's hours open in London.
    const early = new Date("2026-10-13T06:59:00Z");
    const list = listAt(early);
    view = await openPage(inject("pageUrl"), phone, {
      session,
      clock: early,
      api: {
        [pagePaths.asks]: new Answering((url) => answerPoll(url, list)),
      },
    });
    const { page } = view;
    await page.getByText("1 held until its hours").waitFor();
    await view.offline();
    await page.clock.fastForward(pollMs);
    await page.getByText(notConnected).waitFor();
    await page.clock.fastForward(minute);
    await page
      .getByRole("article")
      .filter({ hasText: "Which date format should the export use?" })
      .waitFor();
    expect(await page.getByText(/held/u).count()).toBe(0);
    expect(await page.getByText(notConnected).count()).toBe(1);
  });
});

describe("sign-in that does not load", () => {
  it("says so after the time limit and offers a reload", async () => {
    view = await openPage(inject("pageUrl"), phone, {
      session,
      clock: "stopped",
      signInStuck: true,
    });
    const { page } = view;
    const reload = page.getByRole("button", { name: "Reload the page" });
    await page.clock.runFor(signInWaitMs - 1000);
    expect(await reload.count()).toBe(0);
    await page.clock.runFor(1000);
    await page.getByText("Sign-in couldn't load.").waitFor();
    await reload.click();
    await expect.poll(() => view?.loads()).toBe(2);
  });
});

describe("an error while rendering", () => {
  it("shows the fallback with a reload, not a blank page", async () => {
    const list = listAt(new Date());
    view = await openPage(inject("pageUrl"), phone, {
      session,
      api: {
        [pagePaths.asks]: new Answering((url) => answerPoll(url, list)),
      },
    });
    const { page } = view;
    await page.getByRole("article").waitFor();
    await view.breakRendering();
    await page.getByText("This page stopped working.").waitFor();
    expect(await page.getByRole("article").count()).toBe(0);
    await page.getByRole("button", { name: "Reload the page" }).waitFor();
  });
});

// As after a deploy that changes the poll's answer: the list first, then
// answers in a shape this page does not know.
const changingAnswer = async () => {
  const list = listAt(new Date());
  let readable = true;
  const opened = await openPage(inject("pageUrl"), phone, {
    session,
    clock: true,
    api: {
      [pagePaths.asks]: new Answering((url) =>
        readable ? answerPoll(url, list) : { version: 4, shape: "new" },
      ),
    },
  });
  await opened.page.getByRole("article").waitFor();
  return {
    opened,
    readable: (now: boolean) => {
      readable = now;
    },
  };
};

describe("a poll answer the page cannot read", () => {
  it("reloads the page once, then says the page is not connected", async () => {
    const { opened, readable } = await changingAnswer();
    view = opened;
    const { page } = view;
    readable(false);
    await page.clock.fastForward(pollMs);
    await expect.poll(() => view?.loads()).toBe(2);
    await page.getByText(notConnected).waitFor();
    const polls = () =>
      view?.apiCalls.filter(({ path }) => path === pagePaths.asks).length;
    // A poll still out when the next falls due is not sent twice, so the
    // clock moves on until three more have gone.
    const after = (polls() ?? 0) + 3;
    await expect
      .poll(async () => {
        await page.clock.fastForward(pollMs);
        return polls();
      })
      .toBeGreaterThanOrEqual(after);
    await page.getByText(notConnected).waitFor();
    expect(view.loads()).toBe(2);
  });

  it("reloads again for a later failure once a poll has been read", async () => {
    const { opened, readable } = await changingAnswer();
    view = opened;
    const { page } = view;
    readable(false);
    await page.clock.fastForward(pollMs);
    await expect.poll(() => view?.loads()).toBe(2);
    await page.getByText(notConnected).waitFor();
    readable(true);
    await page.clock.fastForward(pollMs);
    await page.getByRole("article").waitFor();
    readable(false);
    await page.clock.fastForward(pollMs);
    await expect.poll(() => view?.loads()).toBe(3);
  });
});
