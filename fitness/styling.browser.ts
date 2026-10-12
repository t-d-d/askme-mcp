// ADR 14's check that a thumb can hit everything: on the list and on the
// open card, every button and link is at least 44px by 44px, at phone and
// desktop width, with every control an ask can show.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  askChangePaths,
  pagePaths,
  type AsksAnswer,
  type PageAsk,
} from "../shared/page-api";
import { openPage, Status, type OpenPage } from "../test/browser";

const tap = 44;

const ask = (id: string, summary: string, more: Partial<PageAsk>) => ({
  id,
  summary,
  spokenDetail: `The spoken detail of ${summary}`,
  postedAt: new Date().toISOString(),
  opened: false,
  sort: { hashtags: ["shop"], level: "normal" as const, reason: "Routine." },
  ...more,
});

// One line of summary on the top card, and every shape of link.
const list: AsksAnswer = {
  version: 1,
  everAsked: true,
  hashtags: [{ name: "shop", colour: 1 }],
  asks: [
    ask("both", "Merge it?", {
      actionLink: "https://github.com/t-d-d/askme-mcp/pull/12",
      sessionLink: "https://claude.ai/code/session_01AbC",
    }),
    ask("session", "Which date format?", {
      sessionLink: "https://claude.ai/code/session_01AbC",
    }),
    ask("neither", "Read the draft?", { opened: true }),
  ],
};

// Every button and link the page shows, by its words.
async function tooSmall(view: OpenPage): Promise<string[]> {
  const controls = [
    ...(await view.page.getByRole("button").all()),
    ...(await view.page.getByRole("link").all()),
  ];
  expect(controls.length).toBeGreaterThan(0);
  const small: string[] = [];
  for (const control of controls) {
    const box = await control.boundingBox();
    if (box === null || box.width < tap || box.height < tap) {
      small.push(
        `${(await control.getAttribute("aria-label")) ?? (await control.innerText())}: ${JSON.stringify(box)}`,
      );
    }
  }
  return small;
}

describe.each([
  ["a phone", { width: 390, height: 844 }],
  ["a desktop", { width: 1280, height: 800 }],
])("fitness: things can be tapped (styling.md), on %s", (_, viewport) => {
  let view: OpenPage;
  beforeAll(async () => {
    view = await openPage(inject("pageUrl"), viewport, {
      session: "test-session-token",
      speech: "recorded",
      api: {
        [pagePaths.asks]: list,
        [askChangePaths.dismissed]: new Status(204),
      },
    });
    await view.page.getByRole("article").waitFor();
  });
  afterAll(async () => {
    await view.close();
  });

  it("on the list, with the top card's three buttons and a row of each kind", async () => {
    expect(await view.page.getByRole("article").getByRole("link").count()).toBe(
      3,
    );
    expect(await view.page.getByRole("listitem").count()).toBe(2);
    expect(await tooSmall(view)).toEqual([]);
  });

  it("on the open card, with Listen and both links at its foot", async () => {
    await view.page.getByRole("link", { name: "Merge it?" }).click();
    await view.page.getByRole("button", { name: "Dismiss" }).waitFor();
    expect(await tooSmall(view)).toEqual([]);
  });

  it("on the note after a dismissal, with Undo", async () => {
    await view.page.getByRole("button", { name: "Dismiss" }).click();
    await view.page.getByRole("button", { name: "Undo" }).waitFor();
    expect(await tooSmall(view)).toEqual([]);
  });
});
