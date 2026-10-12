// Acting on an ask from the list: following its links, opening its card,
// listening to it and dismissing it, with Clerk and the page's API faked on
// loopback (ADR 9).
import { afterEach, describe, expect, inject, it } from "vitest";
import {
  askChange,
  askChangePaths,
  pagePaths,
  type AsksAnswer,
  type PageAsk,
} from "../shared/page-api";
import {
  Answering,
  answerPoll,
  openPage,
  Status,
  type OpenPage,
  type PageOptions,
} from "../test/browser";

const phone = { width: 390, height: 844 };
const session = "test-session-token";
const minute = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const pullRequest = "https://github.com/t-d-d/askme-mcp/pull/12";
const issue = "https://github.com/t-d-d/askme-mcp/issues/7";
const ticket = "https://linear.app/askme/issue/ASK-3";
const sessionLink = "https://claude.ai/code/session_01AbC";

const ask = (
  id: string,
  summary: string,
  waited: number,
  more: Partial<PageAsk> = {},
): PageAsk => ({
  id,
  summary,
  spokenDetail: `The spoken detail of ${summary}`,
  postedAt: ago(waited),
  opened: false,
  sort: {
    hashtags: ["shop"],
    level: "normal",
    reason: `The reason for ${summary}`,
  },
  ...more,
});

const listOf = (...asks: PageAsk[]): AsksAnswer => ({
  version: 3,
  everAsked: true,
  hashtags: [{ name: "shop", colour: 1 }],
  formerHashtags: [],
  asks,
});

// The asks of the list below, one for each shape of link.
const both = ask("both", "Merge the fix for checkout rounding?", 40 * minute, {
  actionLink: pullRequest,
  sessionLink,
});
const sessionOnly = ask("session", "Which date format?", 30 * minute, {
  sessionLink,
});
const ticketOnly = ask("ticket", "Pick a name for the ticket.", 20 * minute, {
  actionLink: ticket,
});
const issueOnly = ask("issue", "Close the old issue?", 15 * minute, {
  actionLink: issue,
});
const neither = ask("neither", "Read the newsletter draft?", 10 * minute);

let view: OpenPage | undefined;
afterEach(async () => {
  await view?.close();
  view = undefined;
});

// The page with a list, and the API taking every change to an ask. With
// the clock, time jumps a minute once the list shows, then stands still
// until a test moves it. The clock runs until the pause, and a pause aimed at
// a moment already gone throws, so it aims further ahead than
// vitest.config.ts lets a browser test run.
async function open(
  list: AsksAnswer,
  options: PageOptions & { change?: unknown } = {},
): Promise<OpenPage> {
  const { change = new Status(204), ...rest } = options;
  view = await openPage(inject("pageUrl"), phone, {
    session,
    speech: "recorded",
    ...rest,
    api: {
      [pagePaths.asks]: new Answering((url) => answerPoll(url, list)),
      [askChangePaths.opened]: change,
      [askChangePaths.dismissed]: change,
      ...rest.api,
    },
  });
  await view.page.getByRole("article").waitFor();
  if (options.clock === true) {
    const now = await view.page.evaluate(() => Date.now());
    await view.page.clock.pauseAt(now + minute);
  }
  return view;
}

// The ids the page sent to one of the change routes, in order.
const sentTo = (opened: OpenPage, path: string) =>
  opened.apiCalls
    .filter((call) => call.path === path)
    .map((call) => {
      expect(call.method).toBe("POST");
      expect(call.authorization).toBe(`Bearer ${session}`);
      return askChange.parse(JSON.parse(call.body ?? "")).id;
    });

const rowTexts = async (opened: OpenPage) =>
  (await opened.page.getByRole("listitem").allInnerTexts()).map(
    (row) => row.split("\n")[0],
  );

// Drags an element sideways by a share of its width, as a finger would: to
// the left, or to the right for a share below nought.
async function swipe(
  opened: OpenPage,
  selector: ReturnType<OpenPage["page"]["locator"]>,
  share = 0.6,
) {
  const box = await selector.boundingBox();
  if (box === null) throw new Error("Nothing to swipe.");
  const { mouse } = opened.page;
  const y = box.y + Math.min(box.height / 2, 30);
  const from = share > 0 ? 0.9 : 0.1;
  await mouse.move(box.x + box.width * from, y);
  await mouse.down();
  await mouse.move(box.x + box.width * (from - share), y + 4, { steps: 12 });
  await mouse.up();
}

const hasFocus = (control: ReturnType<OpenPage["page"]["locator"]>) =>
  control.evaluate((element) => element === document.activeElement);

// The style of the outline around an element, as drawn now.
const outline = (element: ReturnType<OpenPage["page"]["locator"]>) =>
  element.evaluate((each) => getComputedStyle(each).outlineStyle);

// Presses Tab until a control has the focus, as a keyboard user reaches it.
async function tabTo(
  opened: OpenPage,
  control: ReturnType<OpenPage["page"]["locator"]>,
) {
  for (let presses = 0; presses < 20; presses += 1) {
    if (await hasFocus(control)) return;
    await opened.page.keyboard.press("Tab");
  }
  throw new Error("Tab never reached the control.");
}

const cardIsOpen = (opened: OpenPage) =>
  opened.page.evaluate(() => window.location.hash.startsWith("#ask/"));

describe("the top card's buttons", () => {
  it("lead the main button to the action link, say what it is, and name its site", async () => {
    const { page } = await open(listOf(both, neither));
    const card = page.getByRole("article");
    const main = card.getByRole("link", { name: /^See pull request/u });
    expect(await main.getAttribute("href")).toBe(pullRequest);
    expect((await main.innerText()).split("\n")).toEqual([
      "See pull request",
      "github.com",
    ]);
  });

  it("have a second control for the session, named for its site, when the ask has both links", async () => {
    const { page } = await open(listOf(both));
    const second = page
      .getByRole("article")
      .getByRole("link", { name: "Reply in the session on claude.ai" });
    expect(await second.getAttribute("href")).toBe(sessionLink);
  });

  it("lead the main button to the session link when there is no action link, with no second control", async () => {
    const { page } = await open(listOf(sessionOnly));
    const card = page.getByRole("article");
    const main = card.getByRole("link", { name: /^Reply in the session/u });
    expect(await main.getAttribute("href")).toBe(sessionLink);
    expect((await main.innerText()).split("\n")).toEqual([
      "Reply in the session",
      "claude.ai",
    ]);
    expect(await card.getByRole("link").count()).toBe(2);
  });

  it.each([
    [issueOnly, "See issue", "github.com"],
    [ticketOnly, "Go to linear.app", "linear.app"],
  ])("say what the link is from its shape alone", async (only, label, site) => {
    const { page } = await open(listOf(only));
    const main = page
      .getByRole("article")
      .getByRole("link", { name: new RegExp(`^${label}`, "u") });
    expect((await main.innerText()).split("\n")).toEqual([label, site]);
  });

  it("open the link where the page stays open, and tell the new page nothing", async () => {
    const { page } = await open(listOf(both));
    const links = await page
      .getByRole("article")
      .getByRole("link", { name: /claude\.ai|github\.com/u })
      .all();
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(await link.getAttribute("target")).toBe("_blank");
      expect(await link.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it("open the card when the summary is tapped", async () => {
    const opened = await open(listOf(both, neither));
    await opened.page
      .getByRole("link", { name: "Merge the fix for checkout rounding?" })
      .click();
    await opened.page.getByRole("link", { name: "All asks" }).waitFor();
    expect(await opened.page.evaluate(() => window.location.hash)).toBe(
      "#ask/both",
    );
    expect(sentTo(opened, askChangePaths.opened)).toEqual([]);
  });

  it("have no main button when the ask has no link, and the summary still opens the card", async () => {
    const { page } = await open(listOf(neither));
    const card = page.getByRole("article");
    expect(await card.getByRole("link").count()).toBe(1);
    await card
      .getByRole("link", { name: "Read the newsletter draft?" })
      .click();
    await page.getByRole("link", { name: "All asks" }).waitFor();
  });
});

describe("the rows", () => {
  it("lead each row to its card, whatever links it has, and show the site its main button leads to", async () => {
    const { page } = await open(
      listOf(both, sessionOnly, ticketOnly, issueOnly),
    );
    const rows = page.getByRole("listitem");
    const expected = [
      ["Which date format?", "#ask/session", "claude.ai"],
      ["Pick a name for the ticket.", "#ask/ticket", "linear.app"],
      ["Close the old issue?", "#ask/issue", "github.com"],
    ];
    expect(await rows.count()).toBe(expected.length);
    for (const [index, [summary, href, site]] of expected.entries()) {
      const link = rows.nth(index).getByRole("link");
      expect(await link.getAttribute("href")).toBe(href);
      expect(await link.getAttribute("target")).toBeNull();
      const text = await link.innerText();
      expect(text.split("\n")[0]).toBe(summary);
      expect(text).toContain(site);
    }
  });

  it("open the card of a row with a link, to listen to and read, and mark nothing opened", async () => {
    const opened = await open(listOf(both, sessionOnly));
    const { page } = opened;
    await page.getByRole("listitem").getByRole("link").click();
    await page.getByRole("link", { name: "All asks" }).waitFor();
    expect(await page.evaluate(() => window.location.hash)).toBe(
      "#ask/session",
    );
    expect(
      await page
        .getByRole("heading", { name: sessionOnly.summary })
        .isVisible(),
    ).toBe(true);
    expect(
      await page.getByRole("button", { name: /^Listen/u }).isVisible(),
    ).toBe(true);
    expect(await page.getByText(sessionOnly.spokenDetail).isVisible()).toBe(
      true,
    );
    expect(
      await page.getByText(sessionOnly.sort?.reason ?? "").isVisible(),
    ).toBe(true);
    expect(sentTo(opened, askChangePaths.opened)).toEqual([]);
  });

  it("open the card of a row with neither link", async () => {
    const { page } = await open(listOf(both, neither));
    const link = page.getByRole("listitem").getByRole("link");
    expect(await link.getAttribute("href")).toBe("#ask/neither");
    expect(await link.getAttribute("target")).toBeNull();
    await link.click();
    await page.getByRole("link", { name: "All asks" }).waitFor();
    expect(
      await page
        .getByRole("heading", { name: "Read the newsletter draft?" })
        .isVisible(),
    ).toBe(true);
  });
});

describe("following a link", () => {
  it("marks the ask as opened, and sinks it below the unopened asks at its level without clearing it", async () => {
    const opened = await open(listOf(both, sessionOnly, neither));
    await opened.page
      .getByRole("article")
      .getByRole("link", { name: /^See pull request/u })
      .click();
    await expect
      .poll(() => sentTo(opened, askChangePaths.opened))
      .toEqual(["both"]);
    await expect
      .poll(async () =>
        (await opened.page.getByRole("article").innerText()).includes(
          "Which date format?",
        ),
      )
      .toBe(true);
    expect(await rowTexts(opened)).toEqual([
      "Read the newsletter draft?",
      "Merge the fix for checkout rounding?",
    ]);
    const row = opened.page.getByRole("listitem").nth(1);
    expect(await row.innerText()).toContain("Opened");
    expect(sentTo(opened, askChangePaths.dismissed)).toEqual([]);
  });

  it("from a row's card marks that ask as opened", async () => {
    const opened = await open(listOf(both, sessionOnly));
    const { page } = opened;
    await page.getByRole("listitem").getByRole("link").click();
    await page.getByRole("link", { name: "All asks" }).waitFor();
    await page.getByRole("link", { name: /^Reply in the session/u }).click();
    await expect
      .poll(() => sentTo(opened, askChangePaths.opened))
      .toEqual(["session"]);
  });

  it("dims an ask the list gives as opened, says so after its age, and keeps it below the unopened ones at its level", async () => {
    const opened = await open(
      listOf(
        { ...both, opened: true },
        sessionOnly,
        ask("high", "Sign off the migration?", minute, {
          opened: true,
          sort: { hashtags: ["shop"], level: "high", reason: "Stalled." },
        }),
      ),
    );
    const { page } = opened;
    // Opened and high still comes before anything normal.
    expect(await page.getByRole("article").innerText()).toContain(
      "Sign off the migration?",
    );
    expect(await page.getByRole("article").innerText()).toContain("Opened");
    expect(await rowTexts(opened)).toEqual([
      "Which date format?",
      "Merge the fix for checkout rounding?",
    ]);
    const rows = page.getByRole("listitem");
    const opacity = (index: number) =>
      rows.nth(index).evaluate((row) => Number(getComputedStyle(row).opacity));
    expect(await opacity(0)).toBe(1);
    expect(await opacity(1)).toBeCloseTo(0.55, 5);
    expect(await rows.nth(1).innerText()).toMatch(/40 min\s+Opened/u);
    expect(
      await page
        .getByRole("article")
        .evaluate((card) => Number(getComputedStyle(card).opacity)),
    ).toBeCloseTo(0.55, 5);
  });
});

describe("the open card", () => {
  const openCard = async (asks: PageAsk[], options: PageOptions = {}) => {
    const opened = await open(listOf(...asks), options);
    await opened.page
      .getByRole("article")
      .getByRole("link", { name: asks[0]?.summary ?? "" })
      .click();
    await opened.page.getByRole("link", { name: "All asks" }).waitFor();
    return opened;
  };

  it("shows the hashtags, the wait, the summary, the spoken text and the reason, in that order", async () => {
    const { page } = await openCard([both]);
    const text = await page.locator("body").innerText();
    const order = [
      "All asks",
      "Dismiss",
      "#shop",
      "Waiting 40 min",
      "Merge the fix for checkout rounding?",
      "Listen",
      "About 10 seconds",
      "The spoken detail of Merge the fix for checkout rounding?",
      "The reason for Merge the fix for checkout rounding?",
      "See pull request",
      "Reply in the session",
    ].map((part) => text.indexOf(part));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("leads the main button at the foot to the action link, and an outlined second one to the session", async () => {
    const { page } = await openCard([both]);
    const main = page.getByRole("link", { name: /^See pull request/u });
    expect(await main.getAttribute("href")).toBe(pullRequest);
    const second = page.getByRole("link", { name: /^Reply in the session/u });
    expect(await second.getAttribute("href")).toBe(sessionLink);
    expect((await second.innerText()).split("\n")).toEqual([
      "Reply in the session",
      "claude.ai",
    ]);
  });

  it("marks the ask as opened when a link at its foot is followed", async () => {
    const opened = await openCard([both]);
    await opened.page
      .getByRole("link", { name: /^Reply in the session/u })
      .click();
    await expect
      .poll(() => sentTo(opened, askChangePaths.opened))
      .toEqual(["both"]);
  });

  it("has no buttons at its foot when the ask has no link", async () => {
    const { page } = await openCard([neither]);
    expect(
      await page
        .getByRole("link")
        .evaluateAll((links) => links.map((link) => link.textContent)),
    ).toEqual(["All asks"]);
  });

  it("shows no reason for an ask not sorted yet", async () => {
    const { page } = await openCard([{ ...neither, sort: null }]);
    expect(await page.locator("body").innerText()).not.toContain("reason");
    expect(await page.getByText("Not sorted yet").isVisible()).toBe(true);
  });

  it("goes back to the list with All asks", async () => {
    const { page } = await openCard([both, neither]);
    await page.getByRole("link", { name: "All asks" }).click();
    await page.getByRole("heading", { name: "1 more waiting" }).waitFor();
  });

  it("opens straight from its address", async () => {
    view = await openPage(`${inject("pageUrl")}#ask/neither`, phone, {
      session,
      api: { [pagePaths.asks]: listOf(both, neither) },
    });
    await view.page
      .getByRole("heading", { name: "Read the newsletter draft?" })
      .waitFor();
  });

  it("gives way to the list when its ask has gone", async () => {
    view = await openPage(`${inject("pageUrl")}#ask/gone`, phone, {
      session,
      api: { [pagePaths.asks]: listOf(both) },
    });
    await view.page.getByRole("article").waitFor();
  });
});

describe("Listen", () => {
  it("reads the top card's spoken text aloud with the browser's own speech", async () => {
    const opened = await open(listOf(both, neither));
    await opened.page
      .getByRole("article")
      .getByRole("button", { name: "Listen" })
      .click();
    expect(await opened.spoken()).toEqual([both.spokenDetail]);
  });

  it("reads the open card's spoken text aloud, and says how long it takes", async () => {
    const opened = await open(listOf(neither));
    await opened.page.getByRole("link", { name: neither.summary }).click();
    await opened.page.getByRole("link", { name: "All asks" }).waitFor();
    const listen = opened.page.getByRole("button", { name: /^Listen/u });
    expect(await listen.innerText()).toMatch(/Listen\s+About 10 seconds/u);
    await listen.click();
    expect(await opened.spoken()).toEqual([neither.spokenDetail]);
  });

  it("is not shown where the browser has no speech, and the text is still there to read", async () => {
    const { page } = await open(listOf(both), { speech: "absent" });
    expect(await page.getByRole("button", { name: /Listen/u }).count()).toBe(0);
    await page.getByRole("link", { name: both.summary }).click();
    await page.getByRole("link", { name: "All asks" }).waitFor();
    expect(await page.getByRole("button", { name: /Listen/u }).count()).toBe(0);
    expect(await page.getByText(both.spokenDetail).isVisible()).toBe(true);
  });
});

describe("dismissing", () => {
  const undoMs = 5000;
  const failed = "That didn't go through. The ask is back.";
  const unavailable = new Status(503, {
    code: "service_unavailable",
    class: "retry",
    message: "askme could not finish this request. Try again in a moment.",
  });
  // The API failing the dismissal of one ask, and taking the others.
  const failingFor = (id: string) =>
    new Answering((_url, _authorization, { body }) =>
      askChange.parse(JSON.parse(body ?? "")).id === id
        ? unavailable
        : new Status(204),
    );

  // Dismisses the top card, then the next one while the first waits, so the
  // first is sent at once and fails while the second waits.
  async function failWhileAnotherWaits(opened: OpenPage) {
    const { page } = opened;
    await swipe(opened, page.getByRole("article"));
    await page.getByRole("button", { name: "Undo" }).waitFor();
    await swipe(opened, page.getByRole("article"));
    await expect.poll(() => page.getByRole("status").innerText()).toBe(failed);
  }

  it("by swiping the top card hides it, shows a note with Undo, and sends the dismissal once the note goes", async () => {
    const opened = await open(listOf(both, neither), { clock: true });
    const { page } = opened;
    await swipe(opened, page.getByRole("article"));
    const note = page.getByRole("status");
    await note.getByRole("button", { name: "Undo" }).waitFor();
    expect(await note.innerText()).toMatch(/^Dismissed\.\s+Undo$/u);
    expect(await page.getByRole("article").innerText()).toContain(
      neither.summary,
    );
    expect(sentTo(opened, askChangePaths.dismissed)).toEqual([]);
    await page.clock.runFor(undoMs - 500);
    expect(sentTo(opened, askChangePaths.dismissed)).toEqual([]);
    await page.clock.runFor(1000);
    await expect
      .poll(() => sentTo(opened, askChangePaths.dismissed))
      .toEqual(["both"]);
    expect(await note.count()).toBe(0);
    expect(await page.getByText(both.summary).count()).toBe(0);
  });

  it("by swiping a row hides that ask", async () => {
    const opened = await open(listOf(both, sessionOnly, neither), {
      clock: true,
    });
    await swipe(opened, opened.page.getByRole("listitem").first(), -0.6);
    await opened.page.getByRole("button", { name: "Undo" }).waitFor();
    expect(await rowTexts(opened)).toEqual(["Read the newsletter draft?"]);
    await opened.page.clock.runFor(undoMs + 500);
    await expect
      .poll(() => sentTo(opened, askChangePaths.dismissed))
      .toEqual(["session"]);
    expect(sentTo(opened, askChangePaths.opened)).toEqual([]);
    expect(await cardIsOpen(opened)).toBe(false);
  });

  it("does nothing on a short drag, and follows no link", async () => {
    const opened = await open(listOf(both, sessionOnly), { clock: true });
    await swipe(opened, opened.page.getByRole("listitem").first(), 0.1);
    expect(await rowTexts(opened)).toEqual(["Which date format?"]);
    expect(
      await opened.page.getByRole("button", { name: "Undo" }).count(),
    ).toBe(0);
    expect(sentTo(opened, askChangePaths.opened)).toEqual([]);
    expect(await cardIsOpen(opened)).toBe(false);
  });

  it("dismisses a row from the keyboard alone, through its card, with a note and Undo", async () => {
    const opened = await open(listOf(both, sessionOnly), { clock: true });
    const { page } = opened;
    await tabTo(opened, page.getByRole("listitem").getByRole("link"));
    await page.keyboard.press("Enter");
    await page.getByRole("link", { name: "All asks" }).waitFor();
    await tabTo(opened, page.getByRole("button", { name: "Dismiss" }));
    await page.keyboard.press("Enter");
    const note = page.getByRole("status");
    await note.getByRole("button", { name: "Undo" }).waitFor();
    expect(await note.innerText()).toMatch(/^Dismissed\.\s+Undo$/u);
    expect(await page.getByText(sessionOnly.summary).count()).toBe(0);
    await page.clock.runFor(undoMs + 500);
    await expect
      .poll(() => sentTo(opened, askChangePaths.dismissed))
      .toEqual(["session"]);
  });

  it("brings the ask back with Undo, and sends nothing", async () => {
    const opened = await open(listOf(both, neither), { clock: true });
    const { page } = opened;
    await swipe(opened, page.getByRole("article"));
    await page.getByRole("button", { name: "Undo" }).click();
    expect(await page.getByRole("article").innerText()).toContain(both.summary);
    expect(await page.getByRole("status").count()).toBe(0);
    await page.clock.runFor(undoMs * 2);
    expect(sentTo(opened, askChangePaths.dismissed)).toEqual([]);
  });

  it("sends the first dismissal at once when a second ask is dismissed", async () => {
    const opened = await open(listOf(both, sessionOnly, neither), {
      clock: true,
    });
    const { page } = opened;
    await swipe(opened, page.getByRole("article"));
    await page.getByRole("button", { name: "Undo" }).waitFor();
    await swipe(opened, page.getByRole("article"));
    await expect
      .poll(() => sentTo(opened, askChangePaths.dismissed))
      .toEqual(["both"]);
    await page.getByRole("button", { name: "Undo" }).click();
    expect(await page.getByRole("article").innerText()).toContain(
      sessionOnly.summary,
    );
  });

  it("from the open card goes back to the list, with the note", async () => {
    const opened = await open(listOf(both, neither), { clock: true });
    const { page } = opened;
    await page.getByRole("link", { name: both.summary }).click();
    await page.getByRole("button", { name: "Dismiss" }).click();
    await page.getByRole("button", { name: "Undo" }).waitFor();
    expect(await page.getByRole("article").innerText()).toContain(
      neither.summary,
    );
    expect(await page.evaluate(() => window.location.hash)).toBe("#asks");
    await page.clock.runFor(undoMs + 500);
    await expect
      .poll(() => sentTo(opened, askChangePaths.dismissed))
      .toEqual(["both"]);
  });

  it("sends a waiting dismissal at once when the page is closed", async () => {
    const opened = await open(listOf(both, neither), { clock: true });
    const { page } = opened;
    await swipe(opened, page.getByRole("article"));
    await page.getByRole("button", { name: "Undo" }).waitFor();
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent("pagehide")),
    );
    await expect
      .poll(() => sentTo(opened, askChangePaths.dismissed))
      .toEqual(["both"]);
  });

  it("leaves no note with Undo for a dismissal sent as the page left, when the page comes back", async () => {
    const opened = await open(listOf(both, neither), { clock: true });
    const { page } = opened;
    await swipe(opened, page.getByRole("article"));
    await page.getByRole("button", { name: "Undo" }).waitFor();
    await page.evaluate(() => {
      const kept = { persisted: true };
      window.dispatchEvent(new PageTransitionEvent("pagehide", kept));
      window.dispatchEvent(new PageTransitionEvent("pageshow", kept));
    });
    await expect
      .poll(() => sentTo(opened, askChangePaths.dismissed))
      .toEqual(["both"]);
    await expect.poll(() => page.getByRole("status").count()).toBe(0);
    expect(await page.getByText(both.summary).count()).toBe(0);
  });

  it("leaves room for the note on an open card, so it covers none of the card's buttons", async () => {
    const opened = await open(listOf(both, sessionOnly, neither), {
      clock: true,
    });
    const { page } = opened;
    await swipe(opened, page.getByRole("article"));
    await page.getByRole("button", { name: "Undo" }).waitFor();
    await page.getByRole("link", { name: sessionOnly.summary }).click();
    await page.getByRole("link", { name: "All asks" }).waitFor();
    const note = await page.getByRole("status").boundingBox();
    const main = await page
      .getByRole("link", { name: /^Reply in the session/u })
      .boundingBox();
    expect(note).not.toBeNull();
    expect(main).not.toBeNull();
    expect((main?.y ?? 0) + (main?.height ?? 0)).toBeLessThanOrEqual(
      note?.y ?? 0,
    );
  });

  it("still opens a row's card from the keyboard after a short touch drag that went back", async () => {
    const opened = await open(listOf(both, sessionOnly));
    const { page } = opened;
    const row = page.getByRole("listitem").first();
    const box = await row.boundingBox();
    if (box === null) throw new Error("No row.");
    const y = box.y + 20;
    const touch = await page.context().newCDPSession(page);
    const at = (x: number) => [{ x: box.x + x, y }];
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: at(300),
    });
    for (const x of [290, 280, 270, 260]) {
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: at(x),
      });
    }
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    expect(await rowTexts(opened)).toEqual(["Which date format?"]);
    await row.getByRole("link").focus();
    await page.keyboard.press("Enter");
    await page.getByRole("link", { name: "All asks" }).waitFor();
    expect(await page.evaluate(() => window.location.hash)).toBe(
      "#ask/session",
    );
  });

  it("brings the card back with a note when the dismissal fails", async () => {
    const opened = await open(listOf(both, neither), {
      clock: true,
      change: unavailable,
    });
    const { page } = opened;
    await swipe(opened, page.getByRole("article"));
    await page.clock.runFor(undoMs + 500);
    const note = page.getByRole("status");
    await expect.poll(() => note.innerText()).toBe(failed);
    expect(await page.getByRole("article").innerText()).toContain(both.summary);
  });

  it("still lets a waiting dismissal be undone when an earlier one fails, once the note that says so goes", async () => {
    const opened = await open(listOf(both, sessionOnly, neither), {
      clock: true,
      change: failingFor("both"),
    });
    const { page } = opened;
    await failWhileAnotherWaits(opened);
    expect(await page.getByRole("article").innerText()).toContain(both.summary);
    expect(await rowTexts(opened)).toEqual([neither.summary]);
    await page.clock.runFor(undoMs + 500);
    await expect
      .poll(() => page.getByRole("status").innerText())
      .toMatch(/^Dismissed\.\s+Undo$/u);
    await page.getByRole("button", { name: "Undo" }).click();
    expect(await rowTexts(opened)).toEqual([
      sessionOnly.summary,
      neither.summary,
    ]);
    await page.clock.runFor(undoMs * 2);
    expect(sentTo(opened, askChangePaths.dismissed)).toEqual(["both"]);
  });

  it("holds a waiting dismissal while the note that an earlier one failed shows, then gives its Undo its full time", async () => {
    const opened = await open(listOf(both, sessionOnly, neither), {
      clock: true,
      change: failingFor("both"),
    });
    const { page } = opened;
    await failWhileAnotherWaits(opened);
    await page.clock.runFor(undoMs + 500);
    await expect
      .poll(() => page.getByRole("status").innerText())
      .toMatch(/^Dismissed\.\s+Undo$/u);
    expect(sentTo(opened, askChangePaths.dismissed)).toEqual(["both"]);
    await page.clock.runFor(undoMs - 1000);
    expect(sentTo(opened, askChangePaths.dismissed)).toEqual(["both"]);
    await page.clock.runFor(1000);
    await expect
      .poll(() => sentTo(opened, askChangePaths.dismissed))
      .toEqual(["both", "session"]);
    expect(await page.getByRole("status").count()).toBe(0);
  });

  it("sends a held dismissal at once when another ask is dismissed over the note that one failed, and the new one keeps its own time", async () => {
    const opened = await open(listOf(both, sessionOnly, neither), {
      clock: true,
      change: failingFor("both"),
    });
    const { page } = opened;
    await failWhileAnotherWaits(opened);
    await page.clock.runFor(1000);
    await swipe(opened, page.getByRole("listitem").first(), -0.6);
    await page.getByRole("button", { name: "Undo" }).waitFor();
    await expect
      .poll(() => sentTo(opened, askChangePaths.dismissed))
      .toEqual(["both", "session"]);
    await page.clock.runFor(undoMs - 500);
    expect(sentTo(opened, askChangePaths.dismissed)).toEqual([
      "both",
      "session",
    ]);
    await page.clock.runFor(1000);
    await expect
      .poll(() => sentTo(opened, askChangePaths.dismissed))
      .toEqual(["both", "session", "neither"]);
    await page.clock.runFor(undoMs * 2);
    expect(sentTo(opened, askChangePaths.dismissed)).toEqual([
      "both",
      "session",
      "neither",
    ]);
  });

  it("sends a held dismissal at once when the page is closed over the note that an earlier one failed", async () => {
    const opened = await open(listOf(both, sessionOnly, neither), {
      clock: true,
      change: failingFor("both"),
    });
    const { page } = opened;
    await failWhileAnotherWaits(opened);
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent("pagehide")),
    );
    await expect
      .poll(() => sentTo(opened, askChangePaths.dismissed))
      .toEqual(["both", "session"]);
  });

  it("lets the ask go when the API no longer has it", async () => {
    const opened = await open(listOf(both, neither), {
      clock: true,
      change: new Status(404, {
        code: "not_found",
        class: "do not retry",
        message: "The account has no ask with this id.",
      }),
    });
    const { page } = opened;
    await swipe(opened, page.getByRole("article"));
    await page.clock.runFor(undoMs + 500);
    await expect
      .poll(() => sentTo(opened, askChangePaths.dismissed))
      .toEqual(["both"]);
    expect(await page.getByText(both.summary).count()).toBe(0);
    expect(await page.getByRole("status").count()).toBe(0);
  });
});

describe("going back to the list from a card", () => {
  const desktop = { width: 1280, height: 800 };
  // A list longer than the screen: the top card and nineteen rows, in the
  // order given.
  const long = Array.from({ length: 20 }, (_, index) =>
    ask(
      `ask${String(index)}`,
      `Ask number ${String(index + 1)}`,
      (60 - index) * minute,
    ),
  );
  const twelfthRow = (opened: OpenPage) =>
    opened.page.getByRole("listitem").nth(11);
  const summaryOf = (opened: OpenPage, summary: string) =>
    opened.page.getByRole("article").getByRole("link", { name: summary });
  const scrolled = (opened: OpenPage) =>
    opened.page.evaluate(() => window.scrollY);

  // Scrolls the twelfth row into view and opens its card, which starts at
  // the top. Gives where the list was.
  async function openTwelfth(opened: OpenPage) {
    const row = twelfthRow(opened);
    await row.scrollIntoViewIfNeeded();
    const at = await scrolled(opened);
    expect(at).toBeGreaterThan(0);
    await row.getByRole("link").click();
    await opened.page.getByRole("link", { name: "All asks" }).waitFor();
    expect(await scrolled(opened)).toBe(0);
    return at;
  }

  async function dismissCard(opened: OpenPage) {
    await opened.page.getByRole("button", { name: "Dismiss" }).click();
    await opened.page.getByRole("button", { name: "Undo" }).waitFor();
  }

  const goBack = {
    "All asks": (opened: OpenPage) =>
      opened.page.getByRole("link", { name: "All asks" }).click(),
    Back: (opened: OpenPage) => opened.page.goBack(),
  };

  it.each(["All asks", "Back"] as const)(
    "with %s leaves the list where it was, and focus on the row that opened the card",
    async (way) => {
      const opened = await open(listOf(...long));
      const at = await openTwelfth(opened);
      await goBack[way](opened);
      await opened.page.getByRole("article").waitFor();
      expect(await scrolled(opened)).toBe(at);
      expect(await hasFocus(twelfthRow(opened).getByRole("link"))).toBe(true);
    },
  );

  it.each(["All asks", "Back"] as const)(
    "with %s puts focus on the top card's summary when it opened the card",
    async (way) => {
      const opened = await open(listOf(both, sessionOnly, neither));
      await summaryOf(opened, both.summary).click();
      await opened.page.getByRole("link", { name: "All asks" }).waitFor();
      await goBack[way](opened);
      await opened.page.getByRole("article").waitFor();
      expect(await hasFocus(summaryOf(opened, both.summary))).toBe(true);
    },
  );

  // The list's screen is drawn anew on the way back from the rules.
  it("after a visit to the rules leaves the list where it was, and focus on the row that opened the card", async () => {
    const opened = await open(listOf(...long), {
      api: {
        [pagePaths.rules]: { text: "", hashtags: [], readFailed: false },
      },
    });
    await opened.page.getByRole("link", { name: "Rules" }).click();
    await opened.page
      .getByRole("heading", { name: "Your rules", exact: true })
      .waitFor();
    await opened.page.goBack();
    await opened.page.getByRole("article").waitFor();
    const at = await openTwelfth(opened);
    await opened.page.goBack();
    await opened.page.getByRole("article").waitFor();
    expect(await scrolled(opened)).toBe(at);
    expect(await hasFocus(twelfthRow(opened).getByRole("link"))).toBe(true);
  });

  it("after Dismiss leaves the list where it was, and focus on the next row", async () => {
    const opened = await open(listOf(...long));
    const at = await openTwelfth(opened);
    await dismissCard(opened);
    expect(await scrolled(opened)).toBe(at);
    const next = twelfthRow(opened);
    expect((await next.innerText()).split("\n")[0]).toBe("Ask number 14");
    expect(await hasFocus(next.getByRole("link"))).toBe(true);
  });

  it.each([
    ["the last row", [both, sessionOnly, neither]],
    ["the only row", [both, sessionOnly]],
  ])(
    "after Dismiss of %s puts focus on the top card's summary",
    async (_, asks) => {
      const opened = await open(listOf(...asks));
      await opened.page.getByRole("listitem").last().getByRole("link").click();
      await dismissCard(opened);
      expect(await hasFocus(summaryOf(opened, both.summary))).toBe(true);
    },
  );

  it("after Dismiss of the top card's ask puts focus on the summary of the ask after it, now on top", async () => {
    const opened = await open(listOf(both, sessionOnly, neither));
    await summaryOf(opened, both.summary).click();
    await dismissCard(opened);
    expect(await hasFocus(summaryOf(opened, sessionOnly.summary))).toBe(true);
  });

  const allClear = (opened: OpenPage) =>
    opened.page.getByRole("heading", { name: "All clear." });

  it("after Dismiss of the only ask puts focus on All clear, with no outline, and Tab passes it by", async () => {
    const opened = await open(listOf(both));
    await summaryOf(opened, both.summary).click();
    // Reached from the keyboard, so the focus outline shows.
    const dismiss = opened.page.getByRole("button", { name: "Dismiss" });
    await tabTo(opened, dismiss);
    expect(await outline(dismiss)).toBe("solid");
    await opened.page.keyboard.press("Enter");
    await allClear(opened).waitFor();
    expect(await hasFocus(allClear(opened))).toBe(true);
    // The heading is not a control, so it draws no outline.
    expect(await outline(allClear(opened))).toBe("none");
    // Round the page and back again, Tab passes it by.
    for (let presses = 0; presses < 10; presses += 1) {
      await opened.page.keyboard.press("Tab");
      expect(await hasFocus(allClear(opened))).toBe(false);
    }
  });

  it("after Dismiss of the only ask on a hashtag's tab puts focus on All clear under the tabs", async () => {
    const work = ask("work", "Which date format?", 30 * minute, {
      sort: { hashtags: ["work"], level: "normal", reason: "For work." },
    });
    const opened = await open({
      ...listOf(both, work),
      hashtags: [
        { name: "shop", colour: 1 },
        { name: "work", colour: 2 },
      ],
    });
    const workTab = opened.page
      .getByRole("navigation", { name: "Hashtags" })
      .getByRole("button", { name: "#work", exact: true });
    await workTab.click();
    await summaryOf(opened, work.summary).click();
    await dismissCard(opened);
    await allClear(opened).waitFor();
    expect(await workTab.getAttribute("aria-pressed")).toBe("true");
    expect(await hasFocus(allClear(opened))).toBe(true);
  });

  it("after Dismiss of the only ask from a card opened straight from its address puts focus on All clear", async () => {
    view = await openPage(`${inject("pageUrl")}#ask/both`, phone, {
      session,
      api: {
        [pagePaths.asks]: listOf(both),
        [askChangePaths.dismissed]: new Status(204),
      },
    });
    await view.page.getByRole("heading", { name: both.summary }).waitFor();
    await dismissCard(view);
    await allClear(view).waitFor();
    expect(await hasFocus(allClear(view))).toBe(true);
  });

  // The header's link is followed where it is, so the test scrolls nothing.
  it.each([
    ["the rules", phone, "Rules", "Your rules"],
    ["Connect your agents", desktop, "Connect agents", "Connect your agents"],
  ])(
    "leaves the list for %s at the top",
    async (_, viewport, link, heading) => {
      view = await openPage(inject("pageUrl"), viewport, {
        session,
        api: {
          [pagePaths.asks]: listOf(...long),
          [pagePaths.rules]: { text: "", hashtags: [], readFailed: false },
          [pagePaths.connection]: {
            mcpUrl: "https://abc123.execute-api.us-east-1.amazonaws.com/mcp",
          },
        },
      });
      const { page } = view;
      await page.getByRole("article").waitFor();
      await page.evaluate(() => {
        window.scrollTo(0, 400);
      });
      expect(await scrolled(view)).toBe(400);
      await page.getByRole("link", { name: link }).dispatchEvent("click");
      await page.getByRole("heading", { name: heading, exact: true }).waitFor();
      expect(await scrolled(view)).toBe(0);
    },
  );
});
