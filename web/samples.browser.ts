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
  stepUntilShown,
  type OpenPage,
  type PageOptions,
} from "../test/browser";

const phone = { width: 390, height: 844 };
const session = "test-session-token";

const connection: ConnectionAnswer = {
  mcpUrl: "https://abc123.execute-api.us-east-1.amazonaws.com/mcp",
};

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

const refusal = (code: string, headers?: Record<string, string>) =>
  new Status(429, { code, class: "retry", message: "Refused." }, headers);

async function openNewAccount(
  samples: unknown = new Status(204),
  {
    hash = "",
    clock = false,
    postedAnyway = false,
    timeZone,
  }: {
    hash?: string;
    clock?: PageOptions["clock"];
    postedAnyway?: boolean;
    timeZone?: string;
  } = {},
): Promise<OpenPage> {
  let sent = false;
  return openPage(`${inject("pageUrl")}${hash}`, phone, {
    session,
    clock,
    ...(timeZone === undefined ? {} : { timeZone }),
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

// Each wait moves the clock on a second at most, and a test waits twice, so
// the next poll never falls due.
const firstPoll = (view: OpenPage) =>
  stepUntilShown(
    view.page,
    view.page.getByRole("heading", { name: "Your agents can ask here." }),
  );

// The page asks for the list when it loads, and once more after the press.
async function showsSamplesBeforeNextPoll(view: OpenPage): Promise<void> {
  const card = view.page
    .getByRole("article")
    .filter({ hasText: "Approve the hotfix for the login page" });
  await stepUntilShown(view.page, card);
  expect(await card.count()).toBe(1);
  expect(
    view.apiCalls.filter((call) => call.path === pagePaths.asks),
  ).toHaveLength(2);
}

// The cap resets at the next midnight UTC, 01:00 in London.
async function pressIntoCap(hash = ""): Promise<OpenPage> {
  const opened = await openNewAccount(refusal("cap_reached"), {
    hash,
    clock: new Date("2026-10-12T15:00:00Z"),
    timeZone: "Europe/London",
  });
  await samplesButton(opened.page).click();
  await capNote(opened.page).waitFor();
  return opened;
}

const capNote = (page: OpenPage["page"]) =>
  page
    .getByRole("status")
    .filter({ hasText: "You've reached today's limit. It resets at 01:00." });

// The refusal's Date header puts the service's clock at 23:58 UTC, two
// minutes before the cap resets.
async function pressIntoCapAt(pageClock: Date): Promise<OpenPage> {
  const opened = await openNewAccount(
    refusal("cap_reached", { date: "Mon, 12 Oct 2026 23:58:00 GMT" }),
    { clock: { stoppedAt: pageClock }, timeZone: "Europe/London" },
  );
  await firstPoll(opened);
  await samplesButton(opened.page).click();
  await stepUntilShown(opened.page, capNote(opened.page));
  return opened;
}

async function dropsCapNoteAt(
  { page }: OpenPage,
  reset = new Date("2026-10-13T00:00:00Z"),
): Promise<void> {
  await page.clock.pauseAt(new Date(reset.getTime() - 1000));
  expect(await capNote(page).count()).toBe(1);
  await page.clock.runFor(2000);
  await expect.poll(() => capNote(page).count()).toBe(0);
}

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
    view = await openNewAccount(new Status(204), { clock: "stopped" });
    const { page } = view;
    await firstPoll(view);
    await samplesButton(page).click();
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

  // The cap resets at the next midnight UTC: that evening west of UTC, the
  // next morning east of it.
  it.each([
    [
      "the daily cap",
      "cap_reached",
      "Europe/London",
      "You've reached today's limit. It resets at 01:00.",
    ],
    [
      "the daily cap",
      "cap_reached",
      "America/New_York",
      "You've reached today's limit. It resets at 20:00.",
    ],
    [
      "the rate limit",
      "rate_limited",
      "Europe/London",
      "Slow down a little. Try again in a few seconds.",
    ],
  ])(
    "says when %s is reached, and when to try again, in %s",
    async (_, code, timeZone, words) => {
      view = await openNewAccount(refusal(code), {
        clock: new Date("2026-10-12T15:00:00Z"),
        timeZone,
      });
      const { page } = view;
      await samplesButton(page).click();
      const note = page.getByRole("status").filter({ hasText: /\S/u });
      await note.waitFor();
      expect(await note.innerText()).toBe(words);
      expect(await samplesButton(page).isEnabled()).toBe(true);
      expect(await scrollsSideways(page)).toBe(false);
    },
  );

  it("drops the cap note once the cap resets, with no reload", async () => {
    view = await pressIntoCap();
    await dropsCapNoteAt(view);
  });

  it.each([
    ["fast", "2026-10-13T00:01:00Z", "2026-10-13T00:03:00Z"],
    ["slow", "2026-10-12T23:55:00Z", "2026-10-12T23:57:00Z"],
  ])(
    "drops the cap note when the service's day ends, on a clock a few minutes %s",
    async (_, pressed, reset) => {
      view = await pressIntoCapAt(new Date(pressed));
      await dropsCapNoteAt(view, new Date(reset));
    },
  );

  it("shows the samples posted before a limit stopped the press, without waiting for the next poll", async () => {
    view = await openNewAccount(refusal("rate_limited"), {
      clock: "stopped",
      postedAnyway: true,
    });
    const { page } = view;
    await firstPoll(view);
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

  it("goes back to the list's own entry in the history when it came from the list", async () => {
    view = await openNewAccount();
    const { page } = view;
    const entry = () =>
      page.evaluate(() => window.navigation.currentEntry?.index);
    const list = await entry();
    await page.getByRole("link", { name: "Connect your agents" }).click();
    await samplesButton(page).click();
    await page
      .getByRole("article")
      .filter({ hasText: "Approve the hotfix for the login page" })
      .waitFor();
    await expect.poll(entry).toBe(list);
  });

  it("stays, and says so, when the daily cap is reached", async () => {
    view = await openNewAccount(refusal("cap_reached"), {
      hash: "#connect",
      clock: new Date("2026-10-12T15:00:00Z"),
      timeZone: "Europe/London",
    });
    const { page } = view;
    await samplesButton(page).click();
    await page
      .getByRole("status")
      .filter({ hasText: "You've reached today's limit. It resets at 01:00." })
      .waitFor();
    expect(
      await page
        .getByRole("heading", { name: "Connect your agents" })
        .isVisible(),
    ).toBe(true);
  });

  // Connect your agents does not poll the list, so nothing else redraws it.
  it("drops the cap note once the cap resets, with no reload", async () => {
    view = await pressIntoCap("#connect");
    await dropsCapNoteAt(view);
  });
});
