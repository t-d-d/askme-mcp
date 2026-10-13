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
  allClearGaps,
  Answering,
  answerPoll,
  datedPolls,
  failingPolls,
  moveDeviceClock,
  openPage,
  Status,
  stepUntilShown,
  underTheNote,
  type OpenPage,
  type PageOptions,
} from "../test/browser";
import { pollMs } from "./src/poll";

type Locator = ReturnType<OpenPage["page"]["locator"]>;

const phone = { width: 390, height: 844 };
const session = "test-session-token";
const minute = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const pullRequest = "https://github.com/t-d-d/askme-mcp/pull/12";
const issue = "https://github.com/t-d-d/askme-mcp/issues/7";
const ticket = "https://linear.app/askme/issue/ASK-3";
const googleDoc = "https://docs.google.com/document/d/1AbC/edit";
const cloudflare = "https://dash.cloudflare.com/a1b2/example.com/dns";
const aws = "https://console.aws.amazon.com/s3/buckets/shop";
const longPart = "https://averyveryverylongsubdomainname.example.com/a";
const longerPart =
  "https://averyveryveryveryveryveryverylongsubdomainname.example.com/a";
const azure = "https://productionresultssa0.blob.core.windows.net/results/12";
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
const googleDocAndSession = ask(
  "document",
  "Sign off the launch notes?",
  40 * minute,
  { actionLink: googleDoc, sessionLink },
);
const cloudflareAndSession = ask(
  "domain",
  "Renew the shop's domain?",
  40 * minute,
  { actionLink: cloudflare, sessionLink },
);

const awsAndSession = ask("bucket", "Empty the old bucket?", 40 * minute, {
  actionLink: aws,
  sessionLink,
});

const longPartAndSession = ask("part", "Check the old host?", 40 * minute, {
  actionLink: longPart,
  sessionLink,
});

let view: OpenPage | undefined;
afterEach(async () => {
  await view?.close();
  view = undefined;
});

// What open takes besides the list: the page's options, the answer to a
// change of an ask, and the screen.
type OpenOptions = PageOptions & {
  change?: unknown;
  screen?: { width: number; height: number };
};

// The page with a list, on a phone unless another screen is given, and the
// API taking every change to an ask. With the clock, time jumps a minute
// once the list shows, then stands still until a test moves it. The clock
// runs until the pause, and a pause aimed at a moment already gone throws,
// so it aims further ahead than vitest.config.ts lets a browser test run.
async function open(
  list: AsksAnswer,
  options: OpenOptions = {},
): Promise<OpenPage> {
  const { change = new Status(204), screen = phone, ...rest } = options;
  view = await openPage(inject("pageUrl"), screen, {
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

// The top card on a narrow phone, with Listen and the session beside the
// main button, which leave the main button at its narrowest.
async function narrowCard(top: PageAsk) {
  const { page } = await open(listOf(top), {
    screen: { width: 360, height: phone.height },
  });
  const card = page.getByRole("article");
  await card.getByRole("button", { name: "Listen" }).waitFor();
  await card
    .getByRole("link", { name: /^Reply in the session on claude\.ai/u })
    .waitFor();
  return card;
}

// The one row of a list on a 320px phone, its main button leading to the
// link. Under #shopping and waiting 50 minutes unless told otherwise, which
// leave the site's name less room than a whole line.
async function narrowRow(
  actionLink: string,
  {
    hashtag = "shopping",
    waited = 50 * minute,
    opened = false,
  }: { hashtag?: string; waited?: number; opened?: boolean } = {},
) {
  const row = ask("row", "Empty the old bucket?", waited, {
    actionLink,
    opened,
    sort: {
      hashtags: [hashtag],
      level: "normal",
      reason: "The reason for emptying the old bucket",
    },
  });
  const { page } = await open(
    {
      ...listOf(ask("first", "Pay the deposit?", waited + 10 * minute), row),
      hashtags: [
        { name: "shop", colour: 1 },
        { name: hashtag, colour: 2 },
      ],
    },
    { screen: { width: 320, height: phone.height } },
  );
  return page.getByRole("listitem");
}

// How many lines an element's text takes, in the page's own font.
const lineCount = (element: Locator) =>
  element.evaluate(async (each) => {
    await document.fonts.ready;
    const range = document.createRange();
    range.selectNodeContents(each);
    const rects = [...range.getClientRects()];
    return new Set(rects.map(({ top }) => Math.round(top))).size;
  });

// Where an element's text starts each new line after the first, as the text
// before the break, in the page's own font.
const lineEnds = (element: Locator) =>
  element.evaluate(async (each) => {
    await document.fonts.ready;
    const walker = document.createTreeWalker(each, NodeFilter.SHOW_TEXT);
    const ends: string[] = [];
    let before = "";
    let top: number | undefined;
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      for (let at = 0; at < text.length; at += 1) {
        range.setStart(node, at);
        range.setEnd(node, at + 1);
        const here = Math.round(range.getBoundingClientRect().top);
        if (top !== undefined && here !== top) ends.push(before);
        top = here;
        before += text.charAt(at);
      }
    }
    return ends;
  });

// Whether an element's content fits its width, with nothing past its edge.
const fitsWidth = (element: Locator) =>
  element.evaluate((each) => each.scrollWidth <= each.clientWidth);

// The right edge of each line of an element's text, in the page's own font.
const lineRights = (element: Locator) =>
  element.evaluate(async (each) => {
    await document.fonts.ready;
    const range = document.createRange();
    range.selectNodeContents(each);
    const rights = new Map<number, number>();
    for (const { top, right, width } of range.getClientRects()) {
      if (width === 0) continue;
      const line = Math.round(top);
      rights.set(line, Math.max(rights.get(line) ?? right, right));
    }
    return [...rights.values()];
  });

// Where an element's box starts and ends down the page.
const verticalEdges = (element: Locator) =>
  element.evaluate((each) => {
    const { top, bottom } = each.getBoundingClientRect();
    return { top, bottom };
  });

// Where a row's content ends at the right, inside its padding.
const contentRight = (row: Locator) =>
  row.getByRole("link").evaluate((link) => {
    const { right } = link.getBoundingClientRect();
    return right - parseFloat(getComputedStyle(link).paddingRight);
  });

// A row's meta line when its parts do not all fit on one line: the pill,
// the age and any "Opened" each stay whole, and the site's name moves down
// to a line of its own, with each of its lines ending at the row's right
// edge, inside the row (docs/design.md).
async function expectSiteMovedDown(
  row: Locator,
  { pill, kept, site }: { pill: string; kept: string[]; site: string },
) {
  const pillText = row.getByText(pill, { exact: true });
  for (const part of [
    pillText,
    ...kept.map((each) => row.getByText(each, { exact: true })),
  ]) {
    expect(await lineCount(part)).toBe(1);
  }
  const name = row.getByText(site, { exact: true });
  expect((await verticalEdges(name)).top).toBeGreaterThanOrEqual(
    (await verticalEdges(pillText)).bottom,
  );
  const edge = await contentRight(row);
  for (const right of await lineRights(name)) {
    expect(right).toBeCloseTo(edge, 0);
  }
  expect(await fitsWidth(row)).toBe(true);
}

// A site's name breaks onto another line, and only just after a dot
// (docs/design.md).
async function expectBreaksOnlyAfterDots(name: Locator) {
  const ends = await lineEnds(name);
  expect(ends.length).toBeGreaterThan(0);
  for (const end of ends) expect(end).toMatch(/\.$/u);
}

// The name of a link whose first part is too long for a line on its own,
// longPart unless told otherwise, stays inside its element, and is split
// only inside that part (docs/design.md).
async function expectOnlyLongPartSplit(name: Locator, link = longPart) {
  const [part = ""] = new URL(link).hostname.split(".");
  expect(await fitsWidth(name)).toBe(true);
  const split = (await lineEnds(name)).filter((end) => !end.endsWith("."));
  expect(split.length).toBeGreaterThan(0);
  for (const end of split) expect(part.startsWith(end)).toBe(true);
}

const cardIsOpen = (opened: OpenPage) =>
  opened.page.evaluate(() => window.location.hash.startsWith("#ask/"));

describe("the top card's buttons", () => {
  it("lead the main button to the action link, say what it is, and name its site", async () => {
    const { page } = await open(listOf(both, neither));
    const card = page.getByRole("article");
    const main = card.getByRole("link", { name: /^Pull request/u });
    expect(await main.getAttribute("href")).toBe(pullRequest);
    expect((await main.innerText()).split("\n")).toEqual([
      "Pull request",
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
    [issueOnly, "Issue", "github.com"],
    [ticketOnly, "Open", "linear.app"],
  ])("say what the link is from its shape alone", async (only, label, site) => {
    const { page } = await open(listOf(only));
    const main = page
      .getByRole("article")
      .getByRole("link", { name: new RegExp(`^${label}`, "u") });
    expect((await main.innerText()).split("\n")).toEqual([label, site]);
  });

  it.each([
    ["a pull request's", both, pullRequest],
    ["any other link's", googleDocAndSession, googleDoc],
  ])(
    "keep %s label on one line on a narrow phone, beside both icon buttons",
    async (_, top, link) => {
      const card = await narrowCard(top);
      const label = card.locator(`a[href="${link}"] span`).first();
      expect(await lineCount(label)).toBe(1);
    },
  );

  // A site's name of more than 15 characters is set smaller, so a name as
  // long as dash.cloudflare.com fits whole on one line (docs/design.md).
  it.each([
    {
      site: "docs.google.com",
      top: googleDocAndSession,
      link: googleDoc,
      size: "13px",
    },
    {
      site: "dash.cloudflare.com",
      top: cloudflareAndSession,
      link: cloudflare,
      size: "11px",
    },
  ])(
    "keep $site whole on one line on a narrow phone, beside both icon buttons, at $size",
    async ({ site, top, link, size }) => {
      const card = await narrowCard(top);
      const name = card.locator(`a[href="${link}"] span`).nth(1);
      expect(await name.innerText()).toBe(site);
      expect(await lineCount(name)).toBe(1);
      expect(
        await name.evaluate((each) => getComputedStyle(each).fontSize),
      ).toBe(size);
    },
  );

  // A name too long for one line even at 11px breaks just after a dot, not
  // inside a word (docs/design.md).
  it("break console.aws.amazon.com only after a dot on a narrow phone, beside both icon buttons", async () => {
    const card = await narrowCard(awsAndSession);
    const name = card.locator(`a[href="${aws}"] span`).nth(1);
    expect(await name.innerText()).toBe("console.aws.amazon.com");
    expect(await name.evaluate((each) => getComputedStyle(each).fontSize)).toBe(
      "11px",
    );
    await expectBreaksOnlyAfterDots(name);
  });

  // A part too long for a line on its own is split, so the name stays inside
  // the button, and the rest still breaks after a dot (docs/design.md).
  it("split only a part too long for a line on its own, and keep the name inside the button", async () => {
    const card = await narrowCard(longPartAndSession);
    const name = card.locator(`a[href="${longPart}"] span`).nth(1);
    await expectOnlyLongPartSplit(name);
  });

  it("say in each link's name that it opens a new tab, and show nothing new", async () => {
    const { page } = await open(listOf(both));
    const card = page.getByRole("article");
    for (const name of [
      "Pull request github.com (opens in a new tab)",
      "Reply in the session on claude.ai (opens in a new tab)",
    ]) {
      expect(await card.getByRole("link", { name, exact: true }).count()).toBe(
        1,
      );
    }
    expect(await page.locator("body").innerText()).not.toContain("new tab");
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

  // A site's name that fits beside the pill and the age stays on their line
  // (docs/design.md).
  it("keep github.com on the line of #shopping and the age on a 320px phone", async () => {
    const row = await narrowRow(issue);
    const name = row.getByText("github.com", { exact: true });
    expect(await lineCount(name)).toBe(1);
    expect((await verticalEdges(name)).top).toBeLessThan(
      (await verticalEdges(row.getByText("#shopping", { exact: true }))).bottom,
    );
    expect(await fitsWidth(row)).toBe(true);
  });

  // When the site's name does not fit beside them, it gives way, and the
  // pill and the age stay whole (docs/design.md).
  it("move console.aws.amazon.com to a line of its own at the right on a 320px phone, and keep #shopping and the age whole", async () => {
    const row = await narrowRow(aws);
    await expectSiteMovedDown(row, {
      pill: "#shopping",
      kept: ["50 min"],
      site: "console.aws.amazon.com",
    });
  });

  // The longest hashtag a rule may name, with hyphens to break at and with
  // none, on an opened row that has waited 23 hours (docs/design.md).
  it.each([
    {
      hashtag: "customer-onboarding-flow",
      link: aws,
      site: "console.aws.amazon.com",
    },
    {
      hashtag: "internationalshippingops",
      link: aws,
      site: "console.aws.amazon.com",
    },
    { hashtag: "internationalshippingops", link: issue, site: "github.com" },
  ])(
    "keep #$hashtag, 23 h and Opened whole on a 320px phone, and move $site to a line of its own at the right",
    async ({ hashtag, link, site }) => {
      const row = await narrowRow(link, {
        hashtag,
        waited: 23 * 60 * minute,
        opened: true,
      });
      await expectSiteMovedDown(row, {
        pill: `#${hashtag}`,
        kept: ["23 h", "Opened"],
        site,
      });
    },
  );

  // A site's name too long for a whole line breaks just after a dot, and
  // each of its lines ends at the right (docs/design.md).
  it("break a name too long for a whole line only after a dot, on a line of its own at the right", async () => {
    const row = await narrowRow(longPart);
    const site = new URL(longPart).hostname;
    await expectSiteMovedDown(row, {
      pill: "#shopping",
      kept: ["50 min"],
      site,
    });
    await expectBreaksOnlyAfterDots(row.getByText(site, { exact: true }));
  });

  // A part too long for a whole line on its own is split, so the name stays
  // inside the row (docs/design.md).
  it("split only a part too long for a whole line on its own, and keep the name inside the row", async () => {
    const row = await narrowRow(longerPart);
    const name = row.getByText(new URL(longerPart).hostname, { exact: true });
    await expectOnlyLongPartSplit(name, longerPart);
    expect(await fitsWidth(row)).toBe(true);
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
      .getByRole("link", { name: /^Pull request/u })
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
  const openCard = async (asks: PageAsk[], options: OpenOptions = {}) => {
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
      "Pull request",
      "Reply in the session",
    ].map((part) => text.indexOf(part));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("leads the main button at the foot to the action link, and an outlined second one to the session", async () => {
    const { page } = await openCard([both]);
    const main = page.getByRole("link", { name: /^Pull request/u });
    expect(await main.getAttribute("href")).toBe(pullRequest);
    const second = page.getByRole("link", { name: /^Reply in the session/u });
    expect(await second.getAttribute("href")).toBe(sessionLink);
    expect((await second.innerText()).split("\n")).toEqual([
      "Reply in the session",
      "claude.ai",
    ]);
  });

  it("says in each link's name at its foot that it opens a new tab, and shows nothing new", async () => {
    const { page } = await openCard([both]);
    for (const name of [
      "Pull request github.com (opens in a new tab)",
      "Reply in the session claude.ai (opens in a new tab)",
    ]) {
      expect(await page.getByRole("link", { name, exact: true }).count()).toBe(
        1,
      );
    }
    expect(await page.locator("body").innerText()).not.toContain("new tab");
  });

  // A site's name too long for its button's line breaks just after a dot,
  // not inside a word, on both buttons (docs/design.md).
  it("breaks productionresultssa0.blob.core.windows.net only after a dot on both buttons on a 320px phone", async () => {
    const { page } = await openCard(
      [
        ask("results", "Publish the test results?", 40 * minute, {
          actionLink: azure,
          sessionLink: `${azure}/session`,
        }),
      ],
      { screen: { width: 320, height: phone.height } },
    );
    for (const name of [/^Open/u, /^Reply in the session/u]) {
      const button = page.getByRole("link", { name });
      const site = button.getByText(new URL(azure).hostname, { exact: true });
      await expectBreaksOnlyAfterDots(site);
      expect(await fitsWidth(button)).toBe(true);
    }
  });

  // A part too long for the line on its own is split, so the name stays
  // inside the button (docs/design.md).
  it("splits only a part too long for the line on its own, and keeps the name inside the button", async () => {
    const { page } = await openCard(
      [
        ask("part", "Check the old host?", 40 * minute, {
          actionLink: longerPart,
        }),
      ],
      { screen: { width: 320, height: phone.height } },
    );
    const button = page.getByRole("link", { name: /^Open/u });
    const site = button.getByText(new URL(longerPart).hostname, {
      exact: true,
    });
    await expectOnlyLongPartSplit(site, longerPart);
    expect(await fitsWidth(button)).toBe(true);
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

describe("how long an ask has waited", () => {
  // Monday 12 October 2026, 6pm UTC, by the service's clock.
  const serviceNow = Date.parse("2026-10-12T18:00:00Z");
  const posted = (id: string, summary: string, waited: number) =>
    ask(id, summary, 0, {
      postedAt: new Date(serviceNow - waited).toISOString(),
    });
  const oldest = "Choose the colour for the new labels?";

  // The service gives the time an ask was posted by its own clock, so the
  // top card, the rows and the open card count its age by that clock, even
  // on a page whose clock is a few minutes out. At 18:00 UTC by the
  // service's clock, a clock three minutes fast reads 18:03, and one three
  // minutes slow reads 17:57. The page's clock stands still, and each poll's
  // answer gives the service's time in its Date header.
  it.each([
    ["fast", -3 * minute],
    ["slow", 3 * minute],
  ])(
    "counts by the service's clock, on a clock a few minutes %s",
    async (_, serviceAhead) => {
      view = await openPage(inject("pageUrl"), phone, {
        session,
        clock: { stoppedAt: new Date(serviceNow - serviceAhead) },
        api: {
          [pagePaths.asks]: datedPolls(
            () =>
              listOf(
                posted("a", oldest, 4 * minute),
                posted("b", "Keep the old supplier on?", 2 * minute),
                posted("c", "Reply to the courier?", 0),
              ),
            () => serviceNow,
          ),
        },
      });
      const { page } = view;
      const card = page.getByRole("article");
      await stepUntilShown(page, card);
      expect(await card.innerText()).toContain("Waiting 4 min");
      const rows = await page.getByRole("listitem").allInnerTexts();
      expect(rows).toHaveLength(2);
      expect(rows[0]).toContain("2 min");
      expect(rows[1]).toContain("Just now");
      await card.getByRole("link", { name: oldest }).click();
      await stepUntilShown(page, page.getByRole("link", { name: "All asks" }));
      expect(await page.locator("body").innerText()).toContain("Waiting 4 min");
    },
  );

  // An ask's age is counted to the time the list was last read, by the
  // service's clock as that poll found it. So the device putting its clock
  // right while polls fail leaves it as it was.
  it.each([
    ["fast", -3 * minute],
    ["slow", 3 * minute],
  ])(
    "stays as the last poll that reached askme found it, though a clock a few minutes %s is put right while polls fail",
    async (_, serviceAhead) => {
      const polls = failingPolls(
        () => listOf(posted("a", oldest, 4 * minute)),
        () => serviceNow,
      );
      view = await openPage(inject("pageUrl"), phone, {
        session,
        clock: { stoppedAt: new Date(serviceNow - serviceAhead) },
        api: { [pagePaths.asks]: polls.answering },
      });
      const { page } = view;
      const card = page.getByRole("article");
      await stepUntilShown(page, card);
      expect(await card.innerText()).toContain("Waiting 4 min");
      polls.fail();
      await moveDeviceClock(page, serviceAhead);
      await page.clock.pauseAt(new Date(serviceNow + pollMs + 1000));
      await stepUntilShown(
        page,
        page.getByText("Not connected. Trying again."),
      );
      expect(await card.innerText()).toContain("Waiting 4 min");
    },
  );
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
    const list = page.url();
    await page.getByRole("link", { name: both.summary }).click();
    await page.getByRole("button", { name: "Dismiss" }).click();
    await page.getByRole("button", { name: "Undo" }).waitFor();
    expect(await page.getByRole("article").innerText()).toContain(
      neither.summary,
    );
    await expect.poll(() => page.url()).toBe(list);
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

  // The note shows as the last ask goes, and goes a few seconds later. At
  // 360 by 580 there is room to hold the headline, but little to spare.
  it.each([
    ["390 by 844", phone],
    ["360 by 690", { width: 360, height: 690 }],
    ["360 by 580", { width: 360, height: 580 }],
  ])(
    "leaves All clear's headline where it is on a %s screen while the note shows and after it goes",
    async (_, screen) => {
      const opened = await open(listOf(neither), { clock: true, screen });
      const { page } = opened;
      await swipe(opened, page.getByRole("article"));
      await page.getByRole("heading", { name: "All clear." }).waitFor();
      await page.getByRole("button", { name: "Undo" }).waitFor();
      const { last, note } = await underTheNote(page);
      expect(last).toBeLessThanOrEqual(note);
      const noted = await allClearGaps(page);
      await page.clock.runFor(undoMs + 500);
      await page.getByRole("status").waitFor({ state: "hidden" });
      const gone = await allClearGaps(page);
      expect(Math.abs(noted.above - gone.above)).toBeLessThanOrEqual(1);
    },
  );

  // Some are too short to hold the headline where it is, and some too short
  // for All clear at all, so the page scrolls.
  it("keeps All clear's last line clear of the note on short screens", async () => {
    const opened = await open(listOf(neither), { clock: true });
    const { page } = opened;
    await swipe(opened, page.getByRole("article"));
    await page.getByRole("heading", { name: "All clear." }).waitFor();
    await page.getByRole("button", { name: "Undo" }).waitFor();
    for (const height of [400, 480, 560, 640]) {
      await page.setViewportSize({ width: 360, height });
      const { last, note } = await underTheNote(page);
      expect(last).toBeLessThanOrEqual(note);
    }
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

  // Dismisses the top card and leaves the list for the rules while the note
  // with Undo shows, which sends the dismissal at once.
  async function dismissAndLeave(opened: OpenPage) {
    const { page } = opened;
    await swipe(opened, page.getByRole("article"));
    await page.getByRole("button", { name: "Undo" }).waitFor();
    await page.getByRole("link", { name: "Rules" }).click();
    await page
      .getByRole("heading", { name: "Your rules", exact: true })
      .waitFor();
    await expect
      .poll(() => sentTo(opened, askChangePaths.dismissed))
      .toEqual(["both"]);
  }
  const noRules = { text: "", hashtags: [], readFailed: false };

  it("brings the card back with a note when a dismissal sent as the list was left fails, once the list shows again, for the note's full time", async () => {
    const opened = await open(listOf(both, neither), {
      clock: true,
      change: unavailable,
      api: { [pagePaths.rules]: noRules },
    });
    const { page } = opened;
    await dismissAndLeave(opened);
    await page.clock.runFor(undoMs * 2);
    await page.goBack();
    await page.getByRole("article").waitFor();
    const note = page.getByRole("status");
    await expect.poll(() => note.innerText()).toBe(failed);
    expect(await page.getByRole("article").innerText()).toContain(both.summary);
    await page.clock.runFor(undoMs - 500);
    expect(await note.innerText()).toBe(failed);
    await page.clock.runFor(1000);
    await expect.poll(() => note.count()).toBe(0);
  });

  it("brings the card back with a note when a dismissal sent as the list was left fails after the list shows again", async () => {
    // The failure, held back until the test lets it go.
    let fail: () => void = () => undefined;
    const failing = new Promise<void>((resolve) => {
      fail = resolve;
    });
    const opened = await open(listOf(both, neither), {
      clock: true,
      change: new Answering(async () => {
        await failing;
        return unavailable;
      }),
      api: { [pagePaths.rules]: noRules },
    });
    const { page } = opened;
    await dismissAndLeave(opened);
    await page.goBack();
    await page.getByRole("article").waitFor();
    fail();
    await expect.poll(() => page.getByRole("status").innerText()).toBe(failed);
    expect(await page.getByRole("article").innerText()).toContain(both.summary);
  });

  it("stops the note that a dismissal failed when the list is left, and gives it its full time when the list shows again", async () => {
    const opened = await open(listOf(both, neither), {
      clock: true,
      change: unavailable,
      api: { [pagePaths.rules]: noRules },
    });
    const { page } = opened;
    await swipe(opened, page.getByRole("article"));
    await page.clock.runFor(undoMs + 500);
    const note = page.getByRole("status");
    await expect.poll(() => note.innerText()).toBe(failed);
    await page.getByRole("link", { name: "Rules" }).click();
    await page
      .getByRole("heading", { name: "Your rules", exact: true })
      .waitFor();
    await page.clock.runFor(undoMs * 2);
    await page.goBack();
    await page.getByRole("article").waitFor();
    await expect.poll(() => note.innerText()).toBe(failed);
    await page.clock.runFor(undoMs - 500);
    expect(await note.innerText()).toBe(failed);
    await page.clock.runFor(1000);
    await expect.poll(() => note.count()).toBe(0);
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
  // Numbered asks, in the order given.
  const numbered = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      ask(
        `ask${String(index)}`,
        `Ask number ${String(index + 1)}`,
        (60 - index) * minute,
      ),
    );
  // A list longer than the screen: the top card and nineteen rows.
  const long = numbered(20);
  const twelfthRow = (opened: OpenPage) =>
    opened.page.getByRole("listitem").nth(11);
  const summaryOf = (opened: OpenPage, summary: string) =>
    opened.page.getByRole("article").getByRole("link", { name: summary });
  const scrolled = (opened: OpenPage) =>
    opened.page.evaluate(() => window.scrollY);
  // The focus outline reaches 2px out from a control, 2px away
  // (docs/design.md).
  const outlineReach = 4;

  // Scrolls the page until one edge of a link is so far down the screen.
  const edgeAt = (
    link: ReturnType<OpenPage["page"]["locator"]>,
    edge: "top" | "bottom",
    y: number,
  ) =>
    link.evaluate(
      (each, [side, to]) => {
        window.scrollBy(0, each.getBoundingClientRect()[side] - to);
      },
      [edge, y] as const,
    );

  // How far a link sits below the top of the screen, and above its foot, or
  // above the note while one shows.
  const room = (link: ReturnType<OpenPage["page"]["locator"]>) =>
    link.evaluate((each) => {
      const note = document
        .querySelector('div[role="status"]')
        ?.getBoundingClientRect();
      const foot =
        note === undefined || note.height === 0 ? window.innerHeight : note.top;
      const box = each.getBoundingClientRect();
      return { over: box.top, under: foot - box.bottom };
    });

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

  // Where the page's entry sits in the history.
  const entry = (opened: OpenPage) =>
    opened.page.evaluate(() => window.navigation.currentEntry?.index);

  const closeCard = {
    "All asks": goBack["All asks"],
    Dismiss: dismissCard,
  };

  it.each(["All asks", "Dismiss"] as const)(
    "with %s goes back to the list's own entry in the history, so Back does not come back to the card",
    async (way) => {
      const opened = await open(listOf(both, neither));
      const list = await entry(opened);
      await summaryOf(opened, both.summary).click();
      await opened.page.getByRole("link", { name: "All asks" }).waitFor();
      await closeCard[way](opened);
      await opened.page.getByRole("article").waitFor();
      await expect.poll(() => entry(opened)).toBe(list);
      await opened.page.goBack();
      expect(await cardIsOpen(opened)).toBe(false);
    },
  );

  it("with All asks clicked twice at once goes back to the list only once", async () => {
    const opened = await open(listOf(both, neither));
    const { page } = opened;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // A card, then the list again as an entry of its own, so the card is
    // behind the list.
    await summaryOf(opened, both.summary).click();
    await page.getByRole("link", { name: "All asks" }).waitFor();
    await page.evaluate(() => {
      window.location.hash = "#asks";
    });
    await page.getByRole("article").waitFor();
    const list = await entry(opened);
    await summaryOf(opened, both.summary).click();
    const back = page.getByRole("link", { name: "All asks" });
    await back.waitFor();
    await back.evaluate((link: HTMLElement) => {
      link.click();
      link.click();
    });
    await page.getByRole("article").waitFor();
    // Long enough for a second trip back to land, if one was queued.
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          setTimeout(resolve, 300);
        }),
    );
    expect(await entry(opened)).toBe(list);
    expect(await cardIsOpen(opened)).toBe(false);
    expect(errors).toEqual([]);
  });

  it("with All asks, in a browser that cannot say what is behind, puts the list in the card's place in the history", async () => {
    const opened = await open(listOf(both, neither));
    const { page } = opened;
    await page.addInitScript(() => {
      Reflect.deleteProperty(Window.prototype, "navigation");
      Reflect.deleteProperty(window, "navigation");
    });
    await page.reload();
    await page.getByRole("article").waitFor();
    expect(await page.evaluate(() => "navigation" in window)).toBe(false);
    const entries = await page.evaluate(() => window.history.length);
    await summaryOf(opened, both.summary).click();
    await goBack["All asks"](opened);
    await page.getByRole("article").waitFor();
    expect(
      await page.evaluate(() => [window.location.hash, window.history.length]),
    ).toEqual(["#asks", entries + 1]);
  });

  it.each(["All asks", "Dismiss"] as const)(
    "with %s from a card opened straight from its address puts the list in the card's place in the history",
    async (way) => {
      view = await openPage(`${inject("pageUrl")}#ask/both`, phone, {
        session,
        api: {
          [pagePaths.asks]: listOf(both, neither),
          [askChangePaths.dismissed]: new Status(204),
        },
      });
      await view.page.getByRole("heading", { name: both.summary }).waitFor();
      const card = await entry(view);
      await closeCard[way](view);
      await view.page.getByRole("article").waitFor();
      expect(await view.page.evaluate(() => window.location.hash)).toBe(
        "#asks",
      );
      expect(await entry(view)).toBe(card);
    },
  );

  // Following a link from a card marks its ask opened, which sinks it below
  // the unopened asks at its level, here to the foot of the list.
  it.each(["All asks", "Back"] as const)(
    "with %s after a link on the card sank its ask leaves the list where it was, and focus on the ask that came after it",
    async (way) => {
      const opened = await open(
        listOf(
          ...long.map((each, index) =>
            index === 12 ? { ...each, sessionLink } : each,
          ),
        ),
      );
      const at = await openTwelfth(opened);
      await opened.page
        .getByRole("link", { name: /^Reply in the session/u })
        .click();
      await expect
        .poll(() => sentTo(opened, askChangePaths.opened))
        .toEqual(["ask12"]);
      await goBack[way](opened);
      await opened.page.getByRole("article").waitFor();
      expect((await rowTexts(opened)).at(-1)).toBe("Ask number 13");
      expect(await scrolled(opened)).toBe(at);
      const next = twelfthRow(opened);
      expect((await next.innerText()).split("\n")[0]).toBe("Ask number 14");
      expect(await hasFocus(next.getByRole("link"))).toBe(true);
    },
  );

  it("after a link on the top card's card sank its ask puts focus on the summary of the ask now on top", async () => {
    const opened = await open(listOf(both, sessionOnly, neither));
    await summaryOf(opened, both.summary).click();
    await opened.page.getByRole("link", { name: /^Pull request/u }).click();
    await expect
      .poll(() => sentTo(opened, askChangePaths.opened))
      .toEqual(["both"]);
    await goBack["All asks"](opened);
    await opened.page.getByRole("article").waitFor();
    expect(await rowTexts(opened)).toEqual([neither.summary, both.summary]);
    expect(await hasFocus(summaryOf(opened, sessionOnly.summary))).toBe(true);
  });

  it("shows the row that opened the card when it is below the screen, scrolling only as far as it takes", async () => {
    const opened = await open(listOf(...long));
    const link = twelfthRow(opened).getByRole("link");
    await edgeAt(link, "bottom", 700);
    await openTwelfth(opened);
    // A shorter window leaves the row below the foot of the screen.
    await opened.page.setViewportSize({ width: phone.width, height: 500 });
    await goBack["All asks"](opened);
    await opened.page.getByRole("article").waitFor();
    expect(await hasFocus(link)).toBe(true);
    expect((await room(link)).under).toBeCloseTo(outlineReach, 0);
  });

  it("shows the row that opened the card when it is above the screen, scrolling only as far as it takes", async () => {
    // Long enough to scroll the twelfth row to the top of a phone's screen.
    const opened = await open(listOf(...numbered(40)));
    const link = twelfthRow(opened).getByRole("link");
    await edgeAt(link, "top", 20);
    await openTwelfth(opened);
    // At desktop width the rows sit beside the top card, not under it, so
    // the row is higher up the page, above the top of the screen.
    await opened.page.setViewportSize(desktop);
    await goBack["All asks"](opened);
    await opened.page.getByRole("article").waitFor();
    expect(await hasFocus(link)).toBe(true);
    expect((await room(link)).over).toBeCloseTo(outlineReach, 0);
  });

  it("after Dismiss shows the next row clear of the note, scrolling only as far as it takes", async () => {
    const opened = await open(listOf(...long));
    // The note will cover where the row is.
    await edgeAt(
      twelfthRow(opened).getByRole("link"),
      "bottom",
      phone.height - 10,
    );
    await openTwelfth(opened);
    await dismissCard(opened);
    const next = twelfthRow(opened);
    expect((await next.innerText()).split("\n")[0]).toBe("Ask number 14");
    expect(await hasFocus(next.getByRole("link"))).toBe(true);
    expect((await room(next.getByRole("link"))).under).toBeCloseTo(
      outlineReach,
      0,
    );
  });

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

  it("after Dismiss of the last row leaves the list where it was, and focus on the row now last", async () => {
    const opened = await open(listOf(...long));
    const last = opened.page.getByRole("listitem").last();
    await last.scrollIntoViewIfNeeded();
    const at = await scrolled(opened);
    await last.getByRole("link").click();
    await opened.page.getByRole("link", { name: "All asks" }).waitFor();
    await dismissCard(opened);
    // As far as the page, a row shorter, still scrolls.
    const most = await opened.page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight,
    );
    expect(await scrolled(opened)).toBe(Math.min(at, most));
    expect((await last.innerText()).split("\n")[0]).toBe("Ask number 19");
    expect(await hasFocus(last.getByRole("link"))).toBe(true);
  });

  it("after Dismiss of the only row puts focus on the top card's summary", async () => {
    const opened = await open(listOf(both, sessionOnly));
    await opened.page.getByRole("listitem").getByRole("link").click();
    await dismissCard(opened);
    expect(await hasFocus(summaryOf(opened, both.summary))).toBe(true);
  });

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
