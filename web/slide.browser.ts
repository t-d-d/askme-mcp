import { afterEach, describe, expect, inject, it } from "vitest";
import {
  askChangePaths,
  pagePaths,
  type AsksAnswer,
  type ConnectionAnswer,
  type PageAsk,
} from "../shared/page-api";
import { openPage, Status, type OpenPage } from "../test/browser";

type Page = OpenPage["page"];

const phone = { width: 390, height: 844 };
const minute = 60_000;

const ask = (index: number): PageAsk => ({
  id: `ask${String(index)}`,
  summary: `Ask number ${String(index + 1)}`,
  spokenDetail: `The spoken detail of ask number ${String(index + 1)}`,
  postedAt: new Date(Date.now() - (60 - index) * minute).toISOString(),
  opened: false,
  sort: null,
});

// Longer than the screen: the top card and nineteen rows.
const list: AsksAnswer = {
  version: 1,
  everAsked: true,
  hashtags: [],
  formerHashtags: [],
  asks: Array.from({ length: 20 }, (_, index) => ask(index)),
};

const connection: ConnectionAnswer = {
  mcpUrl: "https://abc123.execute-api.us-east-1.amazonaws.com/mcp",
};

let view: OpenPage | undefined;
afterEach(async () => {
  await view?.close();
  view = undefined;
});

// A slide lasts an hour, so a test can see it under way, then finish it.
async function open(hash: string, motion = true): Promise<Page> {
  view = await openPage(`${inject("pageUrl")}${hash}`, phone, {
    session: "test-session-token",
    motion,
    api: {
      [pagePaths.asks]: list,
      [pagePaths.connection]: connection,
      [pagePaths.rules]: { text: "", hashtags: [], readFailed: false },
      [askChangePaths.dismissed]: new Status(204),
    },
  });
  await view.page.addStyleTag({
    content: ":root { --duration-screen: 3600s; }",
  });
  return view.page;
}

const heading = (page: Page, name: string) =>
  page.getByRole("heading", { name, exact: true }).waitFor();
const theList = (page: Page) => page.getByRole("article").waitFor();
const theCard = (page: Page) =>
  page.getByRole("button", { name: "Dismiss" }).waitFor();
// Index 0 is the top card's summary.
const row = (page: Page, index: number) =>
  page.getByRole("link", {
    name: new RegExp(`^Ask number ${String(index + 1)}\\b`, "u"),
  });

// A view transition's snapshot of a screen: its translate at the start and
// end, and its z-index.
type Picture = "still" | { from: string; to: string; layer: string };

async function moving(
  page: Page,
): Promise<{ leaving: Picture; coming: Picture }> {
  await page.waitForFunction(
    () =>
      document
        .getAnimations()
        .some(
          ({ effect }) =>
            effect instanceof KeyframeEffect &&
            /^::view-transition-(?:old|new)\(/u.test(
              effect.pseudoElement ?? "",
            ),
        ),
    undefined,
    { timeout: 5000 },
  );
  return page.evaluate(() => {
    const picture = (pseudo: string): Picture => {
      const animation = document
        .getAnimations()
        .find(
          ({ effect }) =>
            effect instanceof KeyframeEffect && effect.pseudoElement === pseudo,
        );
      const frames =
        animation?.effect instanceof KeyframeEffect
          ? animation.effect.getKeyframes()
          : [];
      const first = frames.at(0);
      const last = frames.at(-1);
      if (first === undefined || last === undefined) return "still";
      return {
        from: String(first["translate"]),
        to: String(last["translate"]),
        layer: getComputedStyle(document.documentElement, pseudo).zIndex,
      };
    };
    return {
      leaving: picture("::view-transition-old(root)"),
      coming: picture("::view-transition-new(root)"),
    };
  });
}

// The browser clears a finished slide away a frame or so later.
const finish = (page: Page) =>
  page.evaluate(async () => {
    for (const animation of document.getAnimations()) animation.finish();
    for (let frame = 0; frame < 2; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  });

// At the start, the picture of the screen being left lies in place over the
// other.
const atStart = (page: Page) =>
  page.evaluate(async () => {
    for (const animation of document.getAnimations()) {
      animation.pause();
      animation.currentTime = 0;
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });

// At the end, before the browser clears the slide away. A phone can draw a
// frame there.
const atEnd = (page: Page) =>
  page.evaluate(async () => {
    for (const animation of document.getAnimations()) {
      animation.pause();
      animation.currentTime =
        animation.effect?.getComputedTiming().endTime ?? 0;
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });

// The browser's picture of a screen can shade the edge of a letter a step or
// so off the screen itself, so each pixel need only be within a few steps.
const alike = (page: Page, one: Buffer, other: Buffer) =>
  page.evaluate(
    async ({ one, other }) => {
      const pixels = async (png: string) => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        if (context === null) throw new Error("No canvas to read pixels");
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height).data;
      };
      const [a, b] = [await pixels(one), await pixels(other)];
      return (
        a.length === b.length &&
        a.every((value, index) => Math.abs(value - (b[index] ?? Infinity)) <= 4)
      );
    },
    { one: one.toString("base64"), other: other.toString("base64") },
  );

const anyMoving = (page: Page) =>
  page.evaluate(async () => {
    for (let frame = 0; frame < 3; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return document
      .getAnimations()
      .some(
        ({ effect }) =>
          effect instanceof KeyframeEffect &&
          (effect.pseudoElement ?? "").startsWith("::view-transition"),
      );
  });

const right = "100%";
const inPlace = "none";
const slidesIn = {
  leaving: "still",
  coming: { from: right, to: inPlace, layer: "auto" },
};
const slidesOut = {
  leaving: { from: inPlace, to: right, layer: "1" },
  coming: "still",
};

async function slides(
  page: Page,
  act: () => Promise<unknown>,
  way: typeof slidesIn | typeof slidesOut,
) {
  await act();
  expect(await moving(page)).toEqual(way);
  await finish(page);
}

const click = (page: Page, name: string) => () =>
  page.getByRole("link", { name }).click();

// Taps Dismiss and changes the address in the same frame, as a keyboard's
// Back might. Both start just after a frame is drawn, so the change of
// address reaches the page before the next.
async function dismissAndGo(page: Page) {
  const first = await page
    .getByRole("button", { name: "Dismiss" })
    .evaluate(async (button) => {
      await new Promise((resolve) =>
        requestAnimationFrame(() => setTimeout(resolve)),
      );
      if (!(button instanceof HTMLButtonElement)) return "no Dismiss";
      const first = new Promise<string>((resolve) => {
        const came = (what: string) => () => {
          resolve(what);
        };
        window.addEventListener("hashchange", came("the address"), {
          once: true,
        });
        requestAnimationFrame(came("the next frame"));
      });
      button.click();
      window.location.hash = "#asks";
      return first;
    });
  expect(first, "what comes first after Dismiss").toBe("the address");
}

describe("the rules and Connect your agents", () => {
  it("slide in, the rules over the list and Connect your agents over the rules", async () => {
    const page = await open("");
    await theList(page);
    await slides(page, click(page, "Rules"), slidesIn);
    await heading(page, "Your rules");
    await slides(page, click(page, "Connect agents"), slidesIn);
    await heading(page, "Connect your agents");
  });

  it.each([
    ["the rules", "#rules", "Your rules"],
    ["Connect your agents", "#connect", "Connect your agents"],
  ])("slide out on All asks to show the list: %s", async (_, hash, name) => {
    const page = await open(hash);
    await heading(page, name);
    await slides(page, click(page, "All asks"), slidesOut);
    await theList(page);
  });

  // A picture that slid out and then fell back into place would cover the
  // list again for a frame.
  it("keep the rules off the screen at the end of their slide out", async () => {
    const page = await open("#rules");
    await heading(page, "Your rules");
    const rules = await page.screenshot();
    await click(page, "All asks")();
    expect(await moving(page)).toEqual(slidesOut);
    await atEnd(page);
    const ending = await page.screenshot();
    await finish(page);
    await theList(page);
    expect(
      await alike(page, ending, rules),
      "the last frame of the slide is unlike the rules",
    ).toBe(false);
    expect(
      await alike(page, ending, await page.screenshot()),
      "the last frame of the slide shows the list",
    ).toBe(true);
  });

  it("slide out on Back, Connect your agents to show the rules, and the rules to show the list", async () => {
    const page = await open("");
    await theList(page);
    await slides(page, click(page, "Rules"), slidesIn);
    await slides(page, click(page, "Connect agents"), slidesIn);
    await heading(page, "Connect your agents");
    await slides(page, () => page.goBack(), slidesOut);
    await heading(page, "Your rules");
    await slides(page, () => page.goBack(), slidesOut);
    await theList(page);
  });
});

describe("an ask's card", () => {
  it.each([
    ["its row", 11],
    ["the top card", 0],
  ])("slides in over the list from %s", async (_, index) => {
    const page = await open("");
    await theList(page);
    await slides(page, () => row(page, index).click(), slidesIn);
    await theCard(page);
  });

  it.each([
    ["All asks", (page: Page) => click(page, "All asks")()],
    ["Back", (page: Page) => page.goBack()],
    [
      "Dismiss",
      (page: Page) => page.getByRole("button", { name: "Dismiss" }).click(),
    ],
  ])("slides out on %s to show the list", async (_, act) => {
    const page = await open("");
    await theList(page);
    await slides(page, () => row(page, 3).click(), slidesIn);
    await theCard(page);
    await slides(page, () => act(page), slidesOut);
    await theList(page);
  });

  it("leaves the list where it was after sliding out, with focus on the row that opened it", async () => {
    const page = await open("");
    await theList(page);
    await row(page, 11).scrollIntoViewIfNeeded();
    const at = await page.evaluate(() => window.scrollY);
    expect(at).toBeGreaterThan(0);
    await slides(page, () => row(page, 11).click(), slidesIn);
    await theCard(page);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await slides(page, click(page, "All asks"), slidesOut);
    await theList(page);
    expect(await page.evaluate(() => window.scrollY)).toBe(at);
    expect(
      await row(page, 11).evaluate((link) => link === document.activeElement),
    ).toBe(true);
  });

  // The card stays until the slide draws the list, so a second tap can
  // reach Dismiss before then.
  it("dismisses its ask once when Dismiss is tapped twice before the slide", async () => {
    const page = await open("");
    await theList(page);
    await slides(page, () => row(page, 3).click(), slidesIn);
    await theCard(page);
    await page.getByRole("button", { name: "Dismiss" }).evaluate((button) => {
      if (!(button instanceof HTMLButtonElement)) return;
      button.click();
      button.click();
    });
    expect(await moving(page)).toEqual(slidesOut);
    await finish(page);
    await theList(page);
    await page.getByRole("button", { name: "Undo" }).click();
    await row(page, 3).waitFor();
    expect(
      view?.apiCalls.filter(({ path }) => path === askChangePaths.dismissed),
    ).toEqual([]);
  });

  // The change of address waits behind Dismiss, so the picture that slides
  // out is the card's, not the list's.
  it("slides the card out when Dismiss and a change of address come in one frame", async () => {
    const page = await open("");
    await theList(page);
    await slides(page, () => row(page, 3).click(), slidesIn);
    await theCard(page);
    const card = await page.screenshot();
    await dismissAndGo(page);
    expect(await moving(page)).toEqual(slidesOut);
    await atStart(page);
    const leaving = await page.screenshot();
    await finish(page);
    await theList(page);
    expect(
      await alike(page, leaving, card),
      "the picture sliding out is the card",
    ).toBe(true);
    expect(
      await alike(page, await page.screenshot(), card),
      "the list is unlike the card",
    ).toBe(false);
    await page.getByRole("button", { name: "Undo" }).waitFor();
    await expect
      .poll(() => page.evaluate(() => window.location.hash))
      .toBe("#asks");
  });

  // The address names a card, but its ask has gone, so the list shows.
  it("slides by what is drawn, not by the address", async () => {
    const page = await open("#ask/gone");
    await theList(page);
    await slides(page, () => row(page, 3).click(), slidesIn);
    await theCard(page);
    await slides(page, () => page.goBack(), slidesOut);
    await theList(page);
  });
});

it("changes the screen at once when the device asks for reduced motion", async () => {
  const page = await open("", false);
  await theList(page);
  await click(page, "Rules")();
  await heading(page, "Your rules");
  expect(await anyMoving(page)).toBe(false);
  await click(page, "All asks")();
  await theList(page);
  expect(await anyMoving(page)).toBe(false);
  await row(page, 3).click();
  await theCard(page);
  expect(await anyMoving(page)).toBe(false);
  await page.getByRole("button", { name: "Dismiss" }).click();
  await theList(page);
  expect(await anyMoving(page)).toBe(false);
});

// A phone's browser can draw its own movement as the person swipes Back,
// and a slide would move the screen a second time.
it("changes the screen at once on Back when the browser has drawn its own movement", async () => {
  const page = await open("");
  await theList(page);
  await slides(page, click(page, "Rules"), slidesIn);
  await heading(page, "Your rules");
  await page.evaluate(() => {
    Object.defineProperty(PopStateEvent.prototype, "hasUAVisualTransition", {
      configurable: true,
      get: () => true,
    });
  });
  await page.goBack();
  await theList(page);
  expect(await anyMoving(page)).toBe(false);
});

// Both changes are still made, in order.
it("changes the screen at once when the browser draws its own movement in the frame Dismiss slides", async () => {
  const page = await open("");
  await theList(page);
  await slides(page, () => row(page, 3).click(), slidesIn);
  await theCard(page);
  await page.evaluate(() => {
    Object.defineProperty(PopStateEvent.prototype, "hasUAVisualTransition", {
      configurable: true,
      get: () => true,
    });
  });
  await dismissAndGo(page);
  await theList(page);
  expect(await anyMoving(page)).toBe(false);
  await page.getByRole("button", { name: "Undo" }).waitFor();
});
