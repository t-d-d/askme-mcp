import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  askChangePaths,
  pagePaths,
  type AsksAnswer,
  type PageAsk,
} from "../shared/page-api";
import { pageAsk } from "../test/asks";
import { openPage, Status, type OpenPage } from "../test/browser";

const tap = 44;

const ask = (id: string, summary: string, more: Partial<PageAsk>) =>
  pageAsk({
    id,
    summary,
    sort: { hashtags: ["shop"], level: "normal", reason: "Routine." },
    ...more,
  });

// One line of summary on the top card, and every shape of link.
const list: AsksAnswer = {
  version: 1,
  everAsked: true,
  hashtags: [{ name: "shop", colour: 1 }],
  formerHashtags: [],
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

// Relative luminance and contrast ratio, as WCAG 2 defines them, of colours
// as the browser draws them.
type Rgb = [number, number, number];

function luminance(rgb: Rgb): number {
  const [r = 0, g = 0, b = 0] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [light = 0, dark = 0] = [luminance(a), luminance(b)].sort(
    (x, y) => y - x,
  );
  return (light + 0.05) / (dark + 0.05);
}

interface Drawn {
  text: string;
  ink: Rgb;
  ground: Rgb;
}

// Each piece of text in `root`, with its colour and the colour under it as
// they reach the screen: each blended by its own alpha and every opacity
// above it, over whatever is behind.
function drawnText(root: Element): Drawn[] {
  const channels = (colour: string): [number, number, number, number] => {
    const [r = 0, g = 0, b = 0, a = 1] = (colour.match(/[\d.]+/gu) ?? []).map(
      Number,
    );
    return [r, g, b, a];
  };
  const opacity = (element: Element | null): number =>
    element === null
      ? 1
      : Number(getComputedStyle(element).opacity) *
        opacity(element.parentElement);
  const blend = (top: Rgb, alpha: number, under: Rgb): Rgb => [
    top[0] * alpha + under[0] * (1 - alpha),
    top[1] * alpha + under[1] * (1 - alpha),
    top[2] * alpha + under[2] * (1 - alpha),
  ];
  const behind = (element: Element | null): Rgb => {
    for (let at = element; at !== null; at = at.parentElement) {
      const [r, g, b, a] = channels(getComputedStyle(at).backgroundColor);
      if (a > 0) {
        return blend([r, g, b], a * opacity(at), behind(at.parentElement));
      }
    }
    return [255, 255, 255];
  };
  return [root, ...root.querySelectorAll("*")].flatMap((element) => {
    const text = [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? "")
      .join("")
      .trim();
    if (text === "" || !element.checkVisibility()) return [];
    const ground = behind(element);
    const [r, g, b, a] = channels(getComputedStyle(element).color);
    return [
      { text, ink: blend([r, g, b], a * opacity(element), ground), ground },
    ];
  });
}

describe("fitness: the palette is readable (styling.md)", () => {
  const opened = (id: string, summary: string, more: Partial<PageAsk>) => ({
    ...ask(id, summary, more),
    opened: true,
  });
  let view: OpenPage;
  beforeAll(async () => {
    view = await openPage(
      inject("pageUrl"),
      { width: 390, height: 844 },
      {
        session: "test-session-token",
        api: {
          [pagePaths.asks]: {
            ...list,
            asks: [
              opened("top", "Merge it?", {
                actionLink: "https://github.com/t-d-d/askme-mcp/pull/12",
                sessionLink: "https://claude.ai/code/session_01AbC",
              }),
              opened("row", "Which date format?", {
                sessionLink: "https://claude.ai/code/session_01AbC",
              }),
              opened("unsorted", "Read the draft?", { sort: null }),
            ],
          },
        },
      },
    );
    await view.page.getByRole("article").waitFor();
  });
  afterAll(async () => {
    await view.close();
  });

  it("keeps every text on an opened ask at 4.5 to 1, on the top card and the rows", async () => {
    const { page } = view;
    expect(await page.getByRole("listitem").count()).toBe(2);
    const drawn = [...(await page.getByRole("article").evaluate(drawnText))];
    for (const row of await page.getByRole("listitem").all()) {
      drawn.push(...(await row.evaluate(drawnText)));
    }
    expect(drawn.map(({ text }) => text)).toEqual(
      expect.arrayContaining([
        "Merge it?",
        "Which date format?",
        "Read the draft?",
        "#shop",
        "Not sorted yet",
        "Opened",
      ]),
    );
    const faint = drawn
      .map(({ text, ink, ground }) => ({ text, ratio: contrast(ink, ground) }))
      .filter(({ ratio }) => ratio < 4.5);
    expect(faint).toEqual([]);
  });
});
