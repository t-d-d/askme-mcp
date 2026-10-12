// The page once a person has signed in, with Clerk and the page's API
// faked on loopback (ADR 9).
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  pagePaths,
  type AsksAnswer,
  type ConnectionAnswer,
} from "../shared/page-api";
import {
  Answering,
  answerPoll,
  computedColour,
  openPage,
  Status,
  type OpenPage,
} from "../test/browser";
import { cursorInstallLink } from "./src/cursor";
import { palette } from "./src/palette";
import { pollMs } from "./src/poll";

const phone = { width: 390, height: 844 };
const desktop = { width: 1280, height: 800 };
const session = "test-session-token";

const minute = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const connection: ConnectionAnswer = {
  mcpUrl: "https://abc123.execute-api.us-east-1.amazonaws.com/mcp",
};

const ask = (id: string, summary: string, waited: number) => ({
  id,
  summary,
  spokenDetail: `The spoken detail of ${summary}`,
  postedAt: ago(waited),
  opened: false,
  sort: null,
});

// Five asks, in no order: the oldest goes on the top card.
const five: AsksAnswer = {
  version: 5,
  everAsked: true,
  hashtags: [],
  formerHashtags: [],
  asks: [
    ask("d", "Renew the shop's domain for a year, or let it lapse?", 0),
    ask("a", "Merge the fix for checkout rounding? Tests pass.", 31 * minute),
    ask("c", "Swap Saturday's school run with the Okafors?", 12 * minute),
    ask("b", "Which date format should the export use?", 26 * minute),
    ask("e", "Sign off the database migration before the deploy.", 3 * minute),
  ],
};

const empty = (everAsked: boolean): AsksAnswer => ({
  version: everAsked ? 9 : 0,
  everAsked,
  hashtags: [],
  formerHashtags: [],
  asks: [],
});

const allClearLines = [
  "Go and put the kettle on.",
  "Go outside for a bit.",
  "Stretch your legs.",
  "Look out of the window.",
  "Finish that cup of tea.",
  "Nothing to see here. Lovely.",
];

const open = (asks: AsksAnswer | Status, viewport = phone) =>
  openPage(inject("pageUrl"), viewport, {
    session,
    api: {
      [pagePaths.asks]: asks,
      [pagePaths.connection]: connection,
      [pagePaths.rules]: { text: "", hashtags: [], readFailed: false },
    },
  });

const scrollsSideways = (page: OpenPage["page"], width: number) =>
  page
    .evaluate(() => document.documentElement.scrollWidth)
    .then((scrollWidth) => scrollWidth > width);

// The space between the header and All clear's headline, and between its
// last line and the foot of the screen.
const allClearGaps = (page: OpenPage["page"]) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    const header = document.querySelector("header")?.getBoundingClientRect();
    const headline = document.querySelector("h1")?.getBoundingClientRect();
    const last = [...document.querySelectorAll("main p")]
      .at(-1)
      ?.getBoundingClientRect();
    return {
      above: (headline?.top ?? 0) - (header?.bottom ?? 0),
      below: window.innerHeight - (last?.bottom ?? 0),
    };
  });

// The width of each line a paragraph takes, and of the paragraph.
const lineWidths = (page: OpenPage["page"], text: string) =>
  page.evaluate(async (text) => {
    await document.fonts.ready;
    const paragraph = [...document.querySelectorAll("p")].find(
      (p) => p.textContent === text,
    );
    if (paragraph === undefined) return { lines: [], width: 0 };
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    return {
      lines: [...range.getClientRects()].map(({ width }) => width),
      width: paragraph.getBoundingClientRect().width,
    };
  }, text);

describe.each([
  ["a phone", phone],
  ["a desktop", desktop],
])("the list of open asks on %s", (_, viewport) => {
  let view: OpenPage;
  beforeAll(async () => {
    view = await open(five, viewport);
  });
  afterAll(async () => {
    await view.close();
  });

  it("asks the API for the list with the session token", async () => {
    await view.page.getByRole("article").waitFor();
    const calls = view.apiCalls.filter((call) => call.path === pagePaths.asks);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.authorization).toBe(`Bearer ${session}`);
    }
  });

  it("shows the ask that has waited longest large, on the top card", async () => {
    const card = view.page.getByRole("article");
    expect(await card.count()).toBe(1);
    const text = await card.innerText();
    expect(text).toContain("Merge the fix for checkout rounding? Tests pass.");
    expect(text).toContain("Waiting 31 min");
    expect(text).toContain("Not sorted yet");
  });

  it("lists the rest below it as rows, longest waiting first", async () => {
    const { page } = view;
    expect(
      await page.getByRole("heading", { name: "4 more waiting" }).isVisible(),
    ).toBe(true);
    const rows = await page.getByRole("listitem").allInnerTexts();
    expect(rows.map((row) => row.split("\n")[0])).toEqual([
      "Which date format should the export use?",
      "Swap Saturday's school run with the Okafors?",
      "Sign off the database migration before the deploy.",
      "Renew the shop's domain for a year, or let it lapse?",
    ]);
    expect(rows[0]).toContain("26 min");
    expect(rows[3]).toContain("Just now");
    for (const row of rows) expect(row).toContain("Not sorted yet");
  });

  it("selects the Everything tab", async () => {
    const tab = view.page.getByRole("button", { name: "Everything" });
    expect(await tab.getAttribute("aria-pressed")).toBe("true");
  });

  // On a phone the header has one control, which opens the rules, and
  // the rules screen links on to Connect your agents. At desktop width the
  // header has both as text links (docs/design.md, "Header").
  it("links to the rules from the header, and to Connect your agents from the header or the rules", async () => {
    const { page } = view;
    const rules = page.getByRole("link", { name: "Rules" });
    const connect = page.getByRole("link", { name: "Connect agents" });
    expect(await rules.isVisible()).toBe(true);
    expect(await rules.getAttribute("href")).toBe("#rules");
    if (viewport === desktop) {
      expect(await connect.isVisible()).toBe(true);
    } else {
      expect(await connect.isVisible()).toBe(false);
      await rules.click();
      await page
        .getByRole("heading", { name: "Your rules", exact: true })
        .waitFor();
      expect(await connect.isVisible()).toBe(true);
      await page.getByRole("link", { name: "All asks" }).click();
      await page.getByRole("article").waitFor();
    }
  });

  it("scrolls only up and down", async () => {
    expect(await scrollsSideways(view.page, viewport.width)).toBe(false);
  });

  it("makes everything that can be tapped big enough", async () => {
    const controls = [
      ...(await view.page.getByRole("button").all()),
      ...(await view.page.getByRole("link").all()),
    ];
    for (const control of controls) {
      const box = await control.boundingBox();
      expect(box?.height, await control.innerText()).toBeGreaterThanOrEqual(44);
      expect(box?.width, await control.innerText()).toBeGreaterThanOrEqual(44);
    }
  });
});

describe("the top card's spoken detail", () => {
  it("shows beside the top ask at desktop width", async () => {
    const view = await open(five, desktop);
    try {
      expect(
        await view.page
          .getByText("The spoken detail of Merge the fix")
          .isVisible(),
      ).toBe(true);
    } finally {
      await view.close();
    }
  });

  it("waits for the open card on a phone", async () => {
    const view = await open(five, phone);
    try {
      await view.page.getByRole("article").waitFor();
      expect(
        await view.page
          .getByText("The spoken detail of Merge the fix")
          .isVisible(),
      ).toBe(false);
    } finally {
      await view.close();
    }
  });
});

describe("a single open ask", () => {
  const one = { ...five, asks: five.asks.slice(0, 1) };

  it.each([
    ["a phone", phone],
    ["a desktop", desktop],
  ])(
    "on %s is the top card, with nothing else waiting and no rows",
    async (_, viewport) => {
      const view = await open(one, viewport);
      try {
        const { page } = view;
        await page.getByRole("article").waitFor();
        expect(
          await page
            .getByRole("heading", { name: "Nothing else waiting" })
            .isVisible(),
        ).toBe(true);
        expect(await page.getByRole("listitem").count()).toBe(0);
        expect(await page.getByText(/more waiting/u).count()).toBe(0);
      } finally {
        await view.close();
      }
    },
  );

  // The list keeps its column beside the card, so the card does not
  // stretch across the page.
  it("is as wide at desktop width as a top card with more waiting", async () => {
    const width = async (asks: AsksAnswer) => {
      const view = await open(asks, desktop);
      try {
        const box = await view.page.getByRole("article").boundingBox();
        return box?.width;
      } finally {
        await view.close();
      }
    };
    const beside = await width(five);
    expect(beside).toBeDefined();
    expect(await width(one)).toBeCloseTo(beside ?? 0, 0);
  });
});

describe("nothing waiting", () => {
  it("shows a new account how to connect an agent", async () => {
    const view = await open(empty(false));
    try {
      const { page } = view;
      await page
        .getByRole("heading", { name: "Your agents can ask here." })
        .waitFor();
      expect(await page.getByText("All clear.").count()).toBe(0);
      expect(
        await page
          .getByRole("link", { name: "Connect your agents" })
          .isVisible(),
      ).toBe(true);
    } finally {
      await view.close();
    }
  });

  it("tells any other account it is all clear", async () => {
    const view = await open(empty(true));
    try {
      const { page } = view;
      await page.getByRole("heading", { name: "All clear." }).waitFor();
      expect(
        await page.getByText("Your agents are getting on with it.").isVisible(),
      ).toBe(true);
      const shown = await Promise.all(
        allClearLines.map((line) => page.getByText(line).isVisible()),
      );
      expect(shown.filter(Boolean)).toHaveLength(1);
      expect(await page.getByText("Your agents can ask here.").count()).toBe(0);
      expect(await scrollsSideways(page, phone.width)).toBe(false);
    } finally {
      await view.close();
    }
  });

  // A third of the way down: the space above is half the space below.
  it.each([
    ["390 by 844", phone],
    ["360 by 690", { width: 360, height: 690 }],
  ])(
    "sits a third of the way down the free space on a %s screen",
    async (_, viewport) => {
      const view = await open(empty(true), viewport);
      try {
        const { page } = view;
        await page.getByRole("heading", { name: "All clear." }).waitFor();
        const { above, below } = await allClearGaps(page);
        expect(Math.abs(above - below / 2)).toBeLessThanOrEqual(4);
      } finally {
        await view.close();
      }
    },
  );

  it.each([360, 375])(
    "breaks its first line into two even lines at %ipx wide",
    async (width) => {
      const view = await open(empty(true), { width, height: 844 });
      try {
        const { page } = view;
        await page.getByRole("heading", { name: "All clear." }).waitFor();
        const { lines, width: whole } = await lineWidths(
          page,
          "Your agents are getting on with it.",
        );
        expect(lines).toHaveLength(2);
        for (const line of lines) {
          expect(line).toBeGreaterThanOrEqual(whole / 3);
        }
      } finally {
        await view.close();
      }
    },
  );

  it("keeps its first line whole at 390px wide", async () => {
    const view = await open(empty(true));
    try {
      const { page } = view;
      await page.getByRole("heading", { name: "All clear." }).waitFor();
      const { lines } = await lineWidths(
        page,
        "Your agents are getting on with it.",
      );
      expect(lines).toHaveLength(1);
    } finally {
      await view.close();
    }
  });
});

describe("a list that cannot be loaded", () => {
  it("says the page is not connected", async () => {
    const view = await open(new Status(503));
    try {
      await view.page.getByText("Not connected. Trying again.").waitFor();
      expect(await view.page.getByRole("article").count()).toBe(0);
    } finally {
      await view.close();
    }
  });
});

describe("a poll that fails", () => {
  it("keeps the list, says the page is not connected, and tries again", async () => {
    let failing = false;
    const view = await openPage(inject("pageUrl"), phone, {
      session,
      clock: true,
      api: {
        [pagePaths.asks]: new Answering((url) =>
          failing ? new Status(503) : answerPoll(url, five),
        ),
        [pagePaths.connection]: connection,
      },
    });
    try {
      const { page } = view;
      const note = page.getByText("Not connected. Trying again.");
      await page.getByRole("article").waitFor();
      failing = true;
      await page.clock.fastForward(pollMs);
      await note.waitFor();
      expect(await page.getByRole("article").innerText()).toContain(
        "Merge the fix for checkout rounding? Tests pass.",
      );
      expect(await page.getByRole("listitem").count()).toBe(4);
      failing = false;
      await page.clock.fastForward(pollMs);
      await note.waitFor({ state: "detached" });
      expect(await page.getByRole("article").count()).toBe(1);
      expect(await page.getByRole("listitem").count()).toBe(4);
    } finally {
      await view.close();
    }
  });
});

describe("another account signing in on the same page", () => {
  // Two accounts at the same version, so a poll carrying one's version
  // would be answered with nothing new for the other.
  const first: AsksAnswer = {
    version: 3,
    everAsked: true,
    hashtags: [],
    formerHashtags: [],
    asks: [ask("a", "Merge the fix for checkout rounding? Tests pass.", 5)],
  };
  const second: AsksAnswer = {
    version: 3,
    everAsked: true,
    hashtags: [],
    formerHashtags: [],
    asks: [ask("b", "Swap Saturday's school run with the Okafors?", 5)],
  };

  it("sees only its own list, loaded afresh", async () => {
    const view = await openPage(inject("pageUrl"), phone, {
      session: "token-first",
      api: {
        [pagePaths.asks]: new Answering((url, authorization) =>
          answerPoll(
            url,
            authorization === "Bearer token-second" ? second : first,
          ),
        ),
        [pagePaths.connection]: connection,
      },
    });
    try {
      const { page } = view;
      await page
        .getByRole("article")
        .filter({ hasText: "Merge the fix" })
        .waitFor();
      await view.signInAs(null);
      await page.getByRole("button", { name: "Sign in" }).waitFor();
      await view.signInAs("token-second");
      await page
        .getByRole("article")
        .filter({ hasText: "Swap Saturday's school run" })
        .waitFor({ timeout: 3000 });
      expect(await page.getByText("Merge the fix").count()).toBe(0);
      const polls = view.apiCalls.filter(
        (call) =>
          call.path === pagePaths.asks &&
          call.authorization === "Bearer token-second",
      );
      expect(polls[0]?.query).toBe("");
    } finally {
      await view.close();
    }
  });
});

describe.each([
  ["a phone", phone],
  ["a desktop", desktop],
])("Connect your agents on %s", (_, viewport) => {
  let view: OpenPage;
  beforeAll(async () => {
    view = await open(empty(false), viewport);
    await view.page.getByRole("link", { name: "Connect your agents" }).click();
    await view.page
      .getByRole("heading", { name: "Connect your agents" })
      .waitFor();
  });
  afterAll(async () => {
    await view.close();
  });

  it("shows the server address, read only, with a Copy button", async () => {
    const box = view.page.getByLabel("Server address");
    await expect.poll(() => box.inputValue()).toBe(connection.mcpUrl);
    expect(await box.getAttribute("readonly")).not.toBeNull();
    expect(
      await view.page.getByRole("button", { name: "Copy" }).isVisible(),
    ).toBe(true);
  });

  it("gives the steps for Claude", async () => {
    const steps = await view.page
      .getByRole("region", { name: "Claude" })
      .getByRole("listitem")
      .allInnerTexts();
    expect(steps).toEqual([
      "In Claude, add a custom connector.",
      "Paste the server address.",
      "Approve askme when Claude asks you to sign in.",
    ]);
  });

  it("adds askme to Cursor in one click", async () => {
    const link = view.page.getByRole("link", { name: /Add askme to Cursor/u });
    expect(await link.getAttribute("href")).toBe(
      cursorInstallLink(connection.mcpUrl),
    );
  });

  it("carries the demo notice", async () => {
    expect(
      await view.page
        .getByText(
          "Demo. Every ask is deleted after a month, and sign-ups stop at 100 accounts.",
        )
        .isVisible(),
    ).toBe(true);
  });

  it("scrolls only up and down", async () => {
    expect(await scrollsSideways(view.page, viewport.width)).toBe(false);
  });

  it("goes back to the list with All asks", async () => {
    await view.page.getByRole("link", { name: "All asks" }).click();
    await view.page
      .getByRole("heading", { name: "Your agents can ask here." })
      .waitFor();
  });
});

describe("sorted asks", () => {
  const sortedAsk = (
    id: string,
    summary: string,
    waited: number,
    sort: { hashtags: string[]; level: "high" | "normal" | "low" } | null,
  ) => ({
    ...ask(id, summary, waited),
    sort: sort === null ? null : { ...sort, reason: "Sorted by the rules." },
  });

  const sorted: AsksAnswer = {
    version: 7,
    everAsked: true,
    hashtags: [
      { name: "work", colour: 0 },
      { name: "shop", colour: 1 },
      { name: "family", colour: 2 },
    ],
    formerHashtags: [],
    asks: [
      sortedAsk("a", "Swap Saturday's school run?", 40 * minute, {
        hashtags: ["family"],
        level: "low",
      }),
      // The service gives an ask's hashtags in the rules' order.
      sortedAsk("b", "Merge the fix for checkout rounding?", 4 * minute, {
        hashtags: ["work", "shop"],
        level: "high",
      }),
      sortedAsk("c", "Renew the shop's domain?", 0, null),
      sortedAsk("d", "Which date format should the export use?", 12 * minute, {
        hashtags: ["work"],
        level: "normal",
      }),
      sortedAsk("e", "Read the newsletter draft?", 20 * minute, {
        hashtags: [],
        level: "normal",
      }),
    ],
  };

  let view: OpenPage;
  beforeAll(async () => {
    view = await open(sorted);
    await view.page.getByRole("article").waitFor();
  });
  afterAll(async () => {
    await view.close();
  });

  it("orders the list by level, then by how long each ask has waited, with asks not sorted yet last", async () => {
    const { page } = view;
    expect(await page.getByRole("article").innerText()).toContain(
      "Merge the fix for checkout rounding?",
    );
    const rows = await page.getByRole("listitem").allInnerTexts();
    expect(rows.map((row) => row.split("\n")[0])).toEqual([
      "Read the newsletter draft?",
      "Which date format should the export use?",
      "Swap Saturday's school run?",
      "Renew the shop's domain?",
    ]);
  });

  it("shows the top card's hashtags in their colours, in the rules' order", async () => {
    const card = view.page.getByRole("article");
    const pill = (name: string) => card.getByText(name, { exact: true });
    expect(await card.innerText()).not.toContain("Not sorted yet");
    const [shop, work] = await Promise.all(
      ["#shop", "#work"].map((name) =>
        pill(name).evaluate((element) => {
          const style = getComputedStyle(element);
          return { tint: style.backgroundColor, ink: style.color };
        }),
      ),
    );
    const page = view.page;
    expect(shop).toEqual({
      tint: await computedColour(page, palette.orange.tint),
      ink: await computedColour(page, palette.orange.ink),
    });
    expect(work).toEqual({
      tint: await computedColour(page, palette.blue.tint),
      ink: await computedColour(page, palette.blue.ink),
    });
    const text = await card.innerText();
    expect(text.indexOf("#work")).toBeLessThan(text.indexOf("#shop"));
  });

  it("shows each row's first hashtag in its colour, and no pill for an ask in no hashtag", async () => {
    const rows = view.page.getByRole("listitem");
    const tint = (row: number, name: string) =>
      rows
        .nth(row)
        .getByText(name, { exact: true })
        .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(await tint(1, "#work")).toBe(
      await computedColour(view.page, palette.blue.tint),
    );
    expect(await tint(2, "#family")).toBe(
      await computedColour(view.page, palette.purple.tint),
    );
    const unsortedRow = await rows.nth(3).innerText();
    expect(unsortedRow).toContain("Not sorted yet");
    const noHashtag = await rows.nth(0).innerText();
    expect(noHashtag).not.toContain("#");
    expect(noHashtag).not.toContain("Not sorted yet");
  });
});
