// Trying askme with no agent: the example rules a new account starts with,
// and "Send sample asks", with Clerk and the page's API faked on loopback
// (ADR 9).
import { afterEach, describe, expect, inject, it } from "vitest";
import {
  pagePaths,
  samplesPath,
  type AsksAnswer,
  type ConnectionAnswer,
  type Hashtag,
} from "../shared/page-api";
import {
  Answering,
  answerPoll,
  openPage,
  Status,
  type OpenPage,
} from "../test/browser";

const phone = { width: 390, height: 844 };
const session = "test-session-token";

const connection: ConnectionAnswer = {
  mcpUrl: "https://abc123.execute-api.us-east-1.amazonaws.com/mcp",
};

// The hashtags a new account starts with, read from the example rules.
const exampleHashtags: Hashtag[] = [
  {
    name: "work",
    colour: 0,
    hours: [
      { days: ["mon", "tue", "wed", "thu", "fri"], from: "08:00", to: "18:00" },
    ],
  },
  { name: "shop", colour: 1 },
  { name: "family", colour: 2 },
];

const newAccount: AsksAnswer = {
  version: 0,
  everAsked: false,
  hashtags: exampleHashtags,
  formerHashtags: [],
  asks: [],
};

const sample = (id: string, summary: string) => ({
  id,
  summary,
  spokenDetail: `The spoken detail of ${summary}`,
  postedAt: new Date().toISOString(),
  opened: false,
  sort: null,
});

// The list once three sample asks are posted, none of them sorted yet.
const withSamples: AsksAnswer = {
  ...newAccount,
  version: 3,
  everAsked: true,
  asks: [
    sample("a", "Approve the hotfix for the login page so it can ship today"),
    sample("b", "Refund the customer whose mug arrived cracked?"),
    sample("c", "Sign the form for Saturday's school trip"),
  ],
};

const refusal = (code: string) =>
  new Status(429, { code, class: "retry", message: "Refused." });

// A new account's page, whose list gains the samples once they are sent,
// and whose samples route answers as given.
async function openNewAccount(
  samples: unknown = new Status(204),
  {
    hash = "",
    clock = false,
    postedAnyway = false,
  }: { hash?: string; clock?: boolean; postedAnyway?: boolean } = {},
): Promise<OpenPage> {
  let sent = false;
  return openPage(`${inject("pageUrl")}${hash}`, phone, {
    session,
    clock,
    api: {
      [pagePaths.asks]: new Answering((url) =>
        answerPoll(url, sent ? withSamples : newAccount),
      ),
      [pagePaths.connection]: connection,
      [samplesPath]: new Answering(async (...call) => {
        const answer =
          samples instanceof Answering
            ? await samples.answer(...call)
            : samples;
        if (postedAnyway || (answer instanceof Status && answer.code === 204))
          sent = true;
        return answer;
      }),
    },
  });
}

// Stops the page's clock once the new account's card shows, just after
// its first poll.
async function stopClock({ page }: OpenPage): Promise<void> {
  await page
    .getByRole("heading", { name: "Your agents can ask here." })
    .waitFor();
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1);
}

// Moves the stopped clock on in small steps, a second in all, well short
// of the next poll, until the sample asks show in the list.
async function showsSamplesBeforeNextPoll({ page }: OpenPage): Promise<void> {
  const card = page
    .getByRole("article")
    .filter({ hasText: "Approve the hotfix for the login page" });
  for (let step = 0; step < 20 && (await card.count()) === 0; step += 1) {
    await page.clock.runFor(50);
  }
  expect(await card.count()).toBe(1);
}

// The page, or a part of it.
const samplesButton = (within: Pick<OpenPage["page"], "getByRole">) =>
  within.getByRole("button", { name: "Send sample asks" });

const scrollsSideways = (page: OpenPage["page"]) =>
  page
    .evaluate(() => document.documentElement.scrollWidth)
    .then((scrollWidth) => scrollWidth > phone.width);

let view: OpenPage | undefined;
afterEach(async () => {
  await view?.close();
  view = undefined;
});

describe("a new account", () => {
  it("shows the hashtags of the example rules it starts with, as tabs", async () => {
    view = await openNewAccount();
    const { page } = view;
    await page
      .getByRole("heading", { name: "Your agents can ask here." })
      .waitFor();
    const tabs = page.getByRole("navigation", { name: "Hashtags" });
    expect(await tabs.getByRole("button").allInnerTexts()).toEqual([
      "Everything",
      "#work",
      "#shop",
      "#family",
    ]);
  });

  it("says it starts with example rules, and offers to connect an agent or send sample asks", async () => {
    view = await openNewAccount();
    const { page } = view;
    await page
      .getByRole("heading", { name: "Your agents can ask here." })
      .waitFor();
    expect(
      await page
        .getByText(
          "When an agent stops to wait for you, its ask appears on this page. It starts with example rules, which are yours to change. Connect an agent, or send sample asks to watch the rules sort them.",
        )
        .isVisible(),
    ).toBe(true);
    expect(
      await page.getByRole("link", { name: "Connect your agents" }).isVisible(),
    ).toBe(true);
    expect(await samplesButton(page).isVisible()).toBe(true);
    expect(await scrollsSideways(page)).toBe(false);
  });

  it("sends sample asks with the session token, and shows them without waiting for the next poll", async () => {
    view = await openNewAccount(new Status(204), { clock: true });
    const { page } = view;
    await stopClock(view);
    await samplesButton(page).click();
    // No poll falls due: the list is asked for again because the samples
    // were sent.
    await showsSamplesBeforeNextPoll(view);
    expect(await page.getByRole("listitem").count()).toBe(2);
    const sends = view.apiCalls.filter((call) => call.path === samplesPath);
    expect(sends).toEqual([
      expect.objectContaining({
        method: "POST",
        authorization: `Bearer ${session}`,
        body: null,
      }),
    ]);
  });

  it("sends once while a press is under way", async () => {
    let answer: (status: Status) => void = () => undefined;
    view = await openNewAccount(
      new Answering(
        () =>
          new Promise<Status>((resolve) => {
            answer = resolve;
          }),
      ),
    );
    const { page } = view;
    const button = samplesButton(page);
    await button.click();
    await expect.poll(() => button.isDisabled()).toBe(true);
    await button.click({ force: true });
    answer(new Status(204));
    await page.getByRole("article").waitFor();
    expect(
      view.apiCalls.filter((call) => call.path === samplesPath),
    ).toHaveLength(1);
  });

  it.each([
    [
      "the daily cap",
      "cap_reached",
      "You've reached today's limit. It resets tomorrow.",
    ],
    [
      "the rate limit",
      "rate_limited",
      "Slow down a little. Try again in a few seconds.",
    ],
  ])(
    "says when %s is reached, and when to try again",
    async (_, code, words) => {
      view = await openNewAccount(refusal(code));
      const { page } = view;
      await samplesButton(page).click();
      const note = page.getByRole("status").filter({ hasText: words });
      await note.waitFor();
      expect(await samplesButton(page).isEnabled()).toBe(true);
      expect(await scrollsSideways(page)).toBe(false);
    },
  );

  // A limit reached part way keeps the asks posted before it, so the list
  // is asked for again even when the press is refused.
  it("shows the samples posted before a limit stopped the press, without waiting for the next poll", async () => {
    view = await openNewAccount(refusal("rate_limited"), {
      clock: true,
      postedAnyway: true,
    });
    const { page } = view;
    await stopClock(view);
    await samplesButton(page).click();
    await showsSamplesBeforeNextPoll(view);
  });

  it("says when the press did not go through", async () => {
    view = await openNewAccount(new Status(503));
    const { page } = view;
    await samplesButton(page).click();
    await page
      .getByRole("status")
      .filter({ hasText: "That didn't go through. Try again." })
      .waitFor();
  });
});

describe("Connect your agents, for someone with no agent yet", () => {
  it("offers sample asks, from three parts of a life", async () => {
    view = await openNewAccount(new Status(204), { hash: "#connect" });
    const { page } = view;
    const section = page.getByRole("region", { name: "No agent yet?" });
    await section.waitFor();
    expect(await section.innerText()).toContain(
      "Send a few sample asks from three parts of a life, and watch your rules sort them.",
    );
    expect(await samplesButton(section).isVisible()).toBe(true);
    expect(await scrollsSideways(page)).toBe(false);
  });

  it("goes to the list once they are sent, where they wait to be sorted", async () => {
    view = await openNewAccount(new Status(204), { hash: "#connect" });
    const { page } = view;
    await samplesButton(page).click();
    await page
      .getByRole("article")
      .filter({ hasText: "Approve the hotfix for the login page" })
      .waitFor();
    expect(new URL(page.url()).hash).toBe("#asks");
  });

  it("stays, and says so, when the daily cap is reached", async () => {
    view = await openNewAccount(refusal("cap_reached"), { hash: "#connect" });
    const { page } = view;
    await samplesButton(page).click();
    await page
      .getByRole("status")
      .filter({ hasText: "You've reached today's limit. It resets tomorrow." })
      .waitFor();
    expect(
      await page
        .getByRole("heading", { name: "Connect your agents" })
        .isVisible(),
    ).toBe(true);
  });
});
