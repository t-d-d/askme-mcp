import { afterEach, describe, expect, inject, it } from "vitest";
import {
  askChangePaths,
  pagePaths,
  samplesPath,
  type AsksAnswer,
  type PageAsk,
} from "../shared/page-api";
import {
  Answering,
  answerPoll,
  openPage,
  Status,
  type OpenPage,
} from "../test/browser";
import { sendSortAndDismiss, watchAnswers } from "../test/live-page";

// The live check's sample step, from test/live-page.ts, against a faked API
// (ADR 26). The live tier runs it against the deployed site.

const phone = { width: 390, height: 844 };
const session = "test-session-token";
const waits = { stepMs: 10_000, sortMs: 20_000 };

const ask = (id: string, summary: string, sorted: boolean): PageAsk => ({
  id,
  summary,
  spokenDetail: `The spoken detail of ${summary}`,
  postedAt: new Date().toISOString(),
  opened: false,
  ...(sorted
    ? { sort: { hashtags: ["work"], level: "normal", reason: "It is work." } }
    : {
        sort: null,
        sortingUntil: new Date(Date.now() + 30 * 60_000).toISOString(),
      }),
});

const older = ask("old", "Review the open pull request", true);

const samples = (sorted: boolean) => [
  ask(
    "a",
    "Approve the hotfix for the login page so it can ship today",
    sorted,
  ),
  ask("b", "Refund the customer whose mug arrived cracked?", sorted),
  ask("c", "Sign the form for Saturday's school trip", sorted),
];

const list = (version: number, asks: PageAsk[]): AsksAnswer => ({
  version,
  everAsked: true,
  hashtags: [{ name: "work", colour: 0 }],
  formerHashtags: [],
  asks,
});

let view: OpenPage | undefined;

afterEach(async () => {
  await view?.close();
  view = undefined;
});

// Before the press the list holds one older ask. After it, the first full
// answer shows the samples not sorted, and the next shows them as sortedBy
// says.
async function openConnect(
  pressed: Status,
  sortedBy: "next poll" | "never",
): Promise<OpenPage> {
  let polls = 0;
  let sent = false;
  const opened = await openPage(inject("pageUrl"), phone, {
    session,
    motion: true,
    api: {
      [pagePaths.asks]: new Answering((url) => {
        if (!sent) return answerPoll(url, list(1, [older]));
        polls += 1;
        const sorted = sortedBy === "next poll" && polls > 1;
        return answerPoll(
          url,
          list(sorted ? 3 : 2, [older, ...samples(sorted)]),
        );
      }),
      [pagePaths.connection]: {
        mcpUrl: "https://abc123.execute-api.us-east-1.amazonaws.com/mcp",
      },
      [samplesPath]: new Answering(() => {
        sent = pressed.code === 204;
        return pressed;
      }),
      [askChangePaths.dismissed]: new Status(204),
      [askChangePaths.opened]: new Status(204),
    },
  });
  view = opened;
  return opened;
}

async function toConnect(opened: OpenPage) {
  // The page polled before the watch began, so it loads again.
  const answer = watchAnswers(opened.page, new URL(inject("pageUrl")).origin);
  await opened.page.reload();
  await opened.page.getByRole("article").first().waitFor();
  await opened.page.evaluate(() => {
    window.location.hash = "#connect";
  });
  return answer;
}

const sentTo = (opened: OpenPage, path: string) =>
  opened.apiCalls
    .filter((call) => call.method === "POST" && call.path === path)
    .map((call) => call.body);

describe("the live check's sample step", () => {
  it("presses Send sample asks once, waits for the sorts, and dismisses each sample", async () => {
    const opened = await openConnect(new Status(204), "next poll");
    const answer = await toConnect(opened);
    const posted = await sendSortAndDismiss(opened.page, answer, waits);
    expect(posted.map(({ id }) => id)).toEqual(["a", "b", "c"]);
    expect(sentTo(opened, samplesPath)).toHaveLength(1);
    expect(sentTo(opened, askChangePaths.dismissed)).toEqual(
      ["a", "b", "c"].map((id) => JSON.stringify({ id })),
    );
    expect(sentTo(opened, askChangePaths.opened)).toEqual([]);
  }, 60_000);

  it("fails, naming the asks, when the samples are not sorted in time", async () => {
    const opened = await openConnect(new Status(204), "never");
    const answer = await toConnect(opened);
    await expect(
      sendSortAndDismiss(opened.page, answer, { ...waits, sortMs: 8_000 }),
    ).rejects.toThrow(
      /Not every sample ask was sorted within 8 seconds of the press\. Still not sorted: Approve the hotfix/u,
    );
    expect(sentTo(opened, askChangePaths.dismissed)).toEqual([]);
  }, 60_000);

  it("fails with the service's words when it refuses the samples", async () => {
    const words =
      "Every sample ask was sent in the last 10 minutes, and sending one again would show nothing new. Wait a few minutes, then send sample asks again.";
    const opened = await openConnect(
      new Status(429, {
        code: "rate_limited",
        class: "retry",
        message: words,
      }),
      "never",
    );
    const answer = await toConnect(opened);
    await expect(
      sendSortAndDismiss(opened.page, answer, waits),
    ).rejects.toThrow(`The service refused the sample asks with 429. ${words}`);
    expect(sentTo(opened, samplesPath)).toHaveLength(1);
  }, 60_000);
});
