// The page once a person has signed in, with Clerk and the page's API
// faked on loopback (ADR 9).
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  pagePaths,
  sinceParam,
  type AsksAnswer,
  type ConnectionAnswer,
} from "../shared/page-api";
import { Answering, openPage, Status, type OpenPage } from "../test/browser";
import { cursorInstallLink } from "./src/cursor";
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
});

// Five asks, in no order: the oldest goes on the top card.
const five: AsksAnswer = {
  version: 5,
  everAsked: true,
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
    api: { [pagePaths.asks]: asks, [pagePaths.connection]: connection },
  });

const scrollsSideways = (page: OpenPage["page"], width: number) =>
  page
    .evaluate(() => document.documentElement.scrollWidth)
    .then((scrollWidth) => scrollWidth > width);

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

  it("links to Connect your agents from the header", async () => {
    expect(
      await view.page.getByRole("link", { name: "Connect agents" }).isVisible(),
    ).toBe(true);
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
  it("is the top card, with no rows and no count below it", async () => {
    const view = await open({ ...five, asks: five.asks.slice(0, 1) });
    try {
      await view.page.getByRole("article").waitFor();
      expect(await view.page.getByRole("listitem").count()).toBe(0);
      expect(await view.page.getByText(/more waiting/u).count()).toBe(0);
    } finally {
      await view.close();
    }
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
          failing
            ? new Status(503)
            : url.searchParams.get(sinceParam) === String(five.version)
              ? { version: five.version, unchanged: true }
              : five,
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
