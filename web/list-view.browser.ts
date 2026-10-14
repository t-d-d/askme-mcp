import { afterEach, describe, expect, inject, it } from "vitest";
import {
  askChangePaths,
  pagePaths,
  type AsksAnswer,
  type Hashtag,
} from "../shared/page-api";
import { pageAsk } from "../test/asks";
import {
  answerPoll,
  Answering,
  openPage,
  Status,
  type OpenPage,
} from "../test/browser";

type Page = OpenPage["page"];

const phone = { width: 390, height: 844 };
const session = "test-session-token";
const minute = 60_000;

// Monday 12 October 2026, 7pm in London, where work's hours have closed.
const evening = new Date("2026-10-12T18:00:00Z");
const later = new Date(evening.getTime() + 10 * minute);

const work: Hashtag = {
  name: "work",
  colour: 0,
  hours: [
    { days: ["mon", "tue", "wed", "thu", "fri"], from: "08:00", to: "18:00" },
  ],
};
const shop: Hashtag = { name: "shop", colour: 1 };

const ask = (id: string, hashtag: string, sortingUntil?: Date) =>
  pageAsk({
    id,
    postedAt: new Date(evening.getTime() - 30 * minute).toISOString(),
    sort: { hashtags: [hashtag], level: "normal", reason: "Sorted." },
    ...(sortingUntil === undefined
      ? {}
      : { sortingUntil: sortingUntil.toISOString() }),
  });

// Later polls are answered as unchanged, so a dismissed ask stays in every
// answer.
const open = (list: AsksAnswer) =>
  openPage(inject("pageUrl"), phone, {
    session,
    clock: evening,
    api: {
      [pagePaths.asks]: new Answering((url) => answerPoll(url, list)),
      [askChangePaths.dismissed]: new Status(204),
    },
  });

const summaries = async (page: Page) => [
  ...(await page.getByRole("article").allInnerTexts()),
  ...(await page.getByRole("listitem").allInnerTexts()),
];

let view: OpenPage | undefined;
afterEach(async () => {
  await view?.close();
  view = undefined;
});

describe("an ask whose hashtag has left the rules, with hours", () => {
  it("is not held back, though those hours are closed", async () => {
    view = await open({
      version: 3,
      everAsked: true,
      hashtags: [shop],
      formerHashtags: [work],
      timeZone: "Europe/London",
      asks: [ask("a", "work"), ask("b", "shop")],
    });
    const { page } = view;
    await page.getByRole("article").waitFor();
    expect(await summaries(page)).toEqual([
      expect.stringContaining("Ask a"),
      expect.stringContaining("Ask b"),
    ]);
    expect(await page.getByText(/held/u).count()).toBe(0);
  });
});

describe("the sorting line after a dismissal on this page", () => {
  it("counts the list without the dismissed ask, before askme drops it", async () => {
    view = await open({
      version: 3,
      everAsked: true,
      hashtags: [shop],
      formerHashtags: [],
      timeZone: "Europe/London",
      asks: [ask("a", "shop", later), ask("b", "shop", later)],
    });
    const { page } = view;
    await page.getByText("Sorting 2 asks with your rules").waitFor();
    // The page's time stands still, so the note with Undo stays, and the
    // dismissal is not yet sent.
    await page.clock.pauseAt(new Date(evening.getTime() + minute));
    await page.getByRole("link", { name: "Ask a" }).click();
    await page.getByRole("button", { name: "Dismiss" }).click();
    await page.getByRole("button", { name: "Undo" }).waitFor();
    await page.getByText("Sorting 1 ask with your rules").waitFor();
    expect(await summaries(page)).toHaveLength(1);
  });
});
