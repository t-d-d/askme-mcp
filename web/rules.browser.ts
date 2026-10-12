// The rules screen, with Clerk and the page's API faked on loopback
// (ADR 9).
import { afterEach, describe, expect, inject, it } from "vitest";
import {
  pagePaths,
  type AsksAnswer,
  type RulesAnswer,
} from "../shared/page-api";
import {
  Answering,
  computedColour,
  openPage,
  Status,
  type OpenPage,
} from "../test/browser";
import { palette } from "./src/palette";

const phone = { width: 390, height: 844 };
const session = "test-session-token";

const text =
  "#work is my day job. Only show it on weekdays between 8am and 6pm.\n\n#shop is my online shop. Anything a customer can see comes first.";

const saved: RulesAnswer = {
  text,
  hashtags: [
    {
      name: "work",
      colour: 0,
      hours: [
        {
          days: ["mon", "tue", "wed", "thu", "fri"],
          from: "08:00",
          to: "18:00",
        },
      ],
    },
    { name: "shop", colour: 1 },
  ],
  readFailed: false,
  timeZone: "Europe/London",
};

// What the screen shows for each hashtag askme read: its pill, then its
// hours.
const rows = (page: OpenPage["page"]) =>
  page
    .getByRole("region", { name: "askme read this from your rules" })
    .getByRole("listitem")
    .allInnerTexts();

const browserZone = (page: OpenPage["page"]) =>
  page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

const list: AsksAnswer = {
  version: 1,
  everAsked: true,
  hashtags: [],
  asks: [],
};

// The rules screen, with the rules answered by the given answer and saved
// by the given one.
async function openRules(
  rules: RulesAnswer | Answering,
  viewport = phone,
  timeZone = "Europe/London",
): Promise<OpenPage> {
  const view = await openPage(`${inject("pageUrl")}#rules`, viewport, {
    session,
    timeZone,
    api: { [pagePaths.rules]: rules, [pagePaths.asks]: list },
  });
  await view.page
    .getByRole("heading", { name: "Your rules", exact: true })
    .waitFor();
  return view;
}

// Answers a load with the rules given, and a save with what the test says.
const rulesApi = (
  loaded: RulesAnswer,
  onSave: (body: string | null) => unknown,
) =>
  new Answering((_, __, sent) =>
    sent.method === "PUT" ? onSave(sent.body) : loaded,
  );

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

let view: OpenPage | undefined;
afterEach(async () => {
  await view?.close();
  view = undefined;
});

describe("the rules screen", () => {
  it("shows the saved rules in one box, and the hashtags askme read, each in its colour", async () => {
    view = await openRules(saved);
    const { page } = view;
    const box = page.getByRole("textbox", {
      name: /Write them in plain English/u,
    });
    expect(await box.inputValue()).toBe(text);
    const read = page.getByRole("region", {
      name: "askme read this from your rules",
    });
    expect(await rows(page)).toEqual([
      "#work\nWeekdays, 8am to 6pm",
      "#shop\nAny time",
    ]);
    const background = (name: string) =>
      read
        .getByText(name, { exact: true })
        .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(await background("#work")).toBe(
      await computedColour(page, palette.blue.tint),
    );
    expect(await background("#shop")).toBe(
      await computedColour(page, palette.orange.tint),
    );
  });

  it("shows each hashtag's hours, one line for each window, and names the time zone they use", async () => {
    view = await openRules({
      ...saved,
      hashtags: [
        {
          name: "family",
          colour: 2,
          hours: [
            {
              days: ["mon", "tue", "wed", "thu", "fri"],
              from: "18:00",
              to: "24:00",
            },
            { days: ["sat", "sun"], from: "00:00", to: "24:00" },
          ],
        },
      ],
      timeZone: "Asia/Tokyo",
    });
    const { page } = view;
    expect(await rows(page)).toEqual([
      "#family\nWeekdays, 6pm to midnight\nWeekends, all day",
    ]);
  });

  it("names the time zone the hours use, taken from this browser", async () => {
    view = await openRules(saved);
    await view.page
      .getByText("Hours use Europe/London, taken from this browser.")
      .waitFor();
  });

  it("says when another browser's time zone gave the hours, and the one saving here uses", async () => {
    view = await openRules(saved, phone, "America/New_York");
    await view.page
      .getByText(
        "Hours use Europe/London, taken from the browser that saved them. Saving here uses America/New_York.",
      )
      .waitFor();
  });

  it("names this browser's time zone before any rules are saved with one", async () => {
    view = await openRules(
      { text: "", hashtags: [], readFailed: false },
      phone,
      "Asia/Tokyo",
    );
    await view.page
      .getByText("Hours use Asia/Tokyo, taken from this browser.")
      .waitFor();
  });

  it("keeps Save rules neutral until the text changes, then ink", async () => {
    view = await openRules(saved);
    const { page } = view;
    const save = page.getByRole("button", { name: "Save rules" });
    expect(await save.isDisabled()).toBe(true);
    expect(await page.getByText("Saved.", { exact: false }).isVisible()).toBe(
      true,
    );
    await page.getByRole("textbox").fill(`${text}\n\n#family is home.`);
    expect(await save.isEnabled()).toBe(true);
    expect(
      await save.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ).toBe(await computedColour(page, "var(--ink)"));
  });

  it("saves the text, says it is reading the rules, then shows the hashtags read", async () => {
    const bodies: (string | null)[] = [];
    view = await openRules(
      rulesApi(saved, async (body) => {
        bodies.push(body);
        await sleep(500);
        return {
          text: `${text}\n\n#family is home.`,
          hashtags: [...saved.hashtags, { name: "family", colour: 2 }],
          readFailed: false,
        } satisfies RulesAnswer;
      }),
    );
    const { page } = view;
    await page.getByRole("textbox").fill(`${text}\n\n#family is home.`);
    await page.getByRole("button", { name: "Save rules" }).click();
    await page.getByText("Reading your rules.").waitFor();
    await page.getByText("#family", { exact: true }).waitFor();
    // With the time zone of this browser, which the hours use.
    expect(bodies).toEqual([
      JSON.stringify({
        text: `${text}\n\n#family is home.`,
        timeZone: await browserZone(page),
      }),
    ]);
    expect(
      await page.getByRole("button", { name: "Save rules" }).isDisabled(),
    ).toBe(true);
    await page.getByText("Saved.", { exact: false }).waitFor();
  });

  it("keeps the text and the old hashtags when askme could not read them, and offers to try again", async () => {
    const changed = `${text}\n\n#family is home.`;
    const bodies: (string | null)[] = [];
    view = await openRules(
      rulesApi(saved, (body) => {
        bodies.push(body);
        return { ...saved, text: changed, readFailed: true };
      }),
    );
    const { page } = view;
    await page.getByRole("textbox").fill(changed);
    await page.getByRole("button", { name: "Save rules" }).click();
    await page
      .getByText("askme couldn't read your rules just now. Your text is saved.")
      .waitFor();
    expect(await page.getByRole("textbox").inputValue()).toBe(changed);
    expect(await rows(page)).toEqual([
      "#work\nWeekdays, 8am to 6pm",
      "#shop\nAny time",
    ]);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1]).toBe(
      JSON.stringify({ text: changed, timeZone: await browserZone(page) }),
    );
  });

  it("says to slow down when the rules are saved too often", async () => {
    view = await openRules(
      rulesApi(
        saved,
        () =>
          new Status(429, {
            code: "rate_limited",
            class: "retry",
            message: "The rules were saved more than 10 times in a minute.",
          }),
      ),
    );
    const { page } = view;
    await page.getByRole("textbox").fill("#work");
    await page.getByRole("button", { name: "Save rules" }).click();
    await page
      .getByText("Slow down a little. Try again in a few seconds.")
      .waitFor();
  });

  it("says there are no hashtags when the box is empty", async () => {
    view = await openRules({ text: "", hashtags: [], readFailed: false });
    expect(
      await view.page
        .getByRole("region", { name: "askme read this from your rules" })
        .innerText(),
    ).toContain("No hashtags yet.");
  });

  it("asks before leaving with unsaved text, and stays when told to", async () => {
    view = await openRules(saved);
    const { page } = view;
    await page.getByRole("textbox").fill("#work only.");
    const asked: string[] = [];
    page.once("dialog", (dialog) => {
      asked.push(dialog.message());
      void dialog.dismiss();
    });
    await page.getByRole("link", { name: "All asks" }).click();
    expect(asked).toEqual(["Leave without saving your rules?"]);
    expect(
      await page
        .getByRole("heading", { name: "Your rules", exact: true })
        .isVisible(),
    ).toBe(true);
    page.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await page.getByRole("link", { name: "All asks" }).click();
    await page.getByRole("heading", { name: "All clear." }).waitFor();
  });

  it("asks before Back leaves unsaved text, and keeps the text when told to stay", async () => {
    view = await openPage(inject("pageUrl"), phone, {
      session,
      api: { [pagePaths.rules]: saved, [pagePaths.asks]: list },
    });
    const { page } = view;
    await page.getByRole("link", { name: "Rules" }).click();
    const box = page.getByRole("textbox");
    await box.fill("#work only.");
    const asked: string[] = [];
    page.once("dialog", (dialog) => {
      asked.push(dialog.message());
      void dialog.dismiss();
    });
    await page.goBack();
    await expect
      .poll(() => asked)
      .toEqual(["Leave without saving your rules?"]);
    expect(new URL(page.url()).hash).toBe("#rules");
    expect(await box.inputValue()).toBe("#work only.");
    page.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await page.goBack();
    await page.getByRole("heading", { name: "All clear." }).waitFor();
  });

  it("asks before a typed address leaves unsaved text, and keeps the text when told to stay", async () => {
    view = await openRules(saved);
    const { page } = view;
    const box = page.getByRole("textbox");
    await box.fill("#work only.");
    const asked: string[] = [];
    page.once("dialog", (dialog) => {
      asked.push(dialog.message());
      void dialog.dismiss();
    });
    await page.goto(`${inject("pageUrl")}#connect`);
    await expect
      .poll(() => asked)
      .toEqual(["Leave without saving your rules?"]);
    expect(new URL(page.url()).hash).toBe("#rules");
    expect(await box.inputValue()).toBe("#work only.");
  });

  it("keeps the history as it was when the person stays after a typed address", async () => {
    view = await openPage(inject("pageUrl"), phone, {
      session,
      api: { [pagePaths.rules]: saved, [pagePaths.asks]: list },
    });
    const { page } = view;
    await page.getByRole("link", { name: "Rules" }).click();
    const box = page.getByRole("textbox");
    await box.fill("#work only.");
    page.once("dialog", (dialog) => {
      void dialog.dismiss();
    });
    await page.goto(`${inject("pageUrl")}#connect`);
    await expect.poll(() => new URL(page.url()).hash).toBe("#rules");
    page.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await page.goBack();
    await page.getByRole("heading", { name: "All clear." }).waitFor();
  });

  it("still asks before Back after a link is opened in a new tab", async () => {
    view = await openPage(inject("pageUrl"), phone, {
      session,
      api: { [pagePaths.rules]: saved, [pagePaths.asks]: list },
    });
    const { page } = view;
    await page.getByRole("link", { name: "Rules" }).click();
    const box = page.getByRole("textbox");
    await box.fill("#work only.");
    const asked: string[] = [];
    page.on("dialog", (dialog) => {
      asked.push(dialog.message());
      void dialog.dismiss();
    });
    const opened = page.context().waitForEvent("page");
    await page
      .getByRole("link", { name: "Connect agents" })
      .click({ modifiers: ["ControlOrMeta"] });
    await (await opened).close();
    expect(asked).toEqual([]);
    await page.goBack();
    await expect
      .poll(() => asked)
      .toEqual(["Leave without saving your rules?"]);
    expect(await box.inputValue()).toBe("#work only.");
  });

  it("asks before the tab closes with unsaved text", async () => {
    view = await openRules(saved);
    const { page } = view;
    await page.getByRole("textbox").fill("#work only.");
    const asked = page.waitForEvent("dialog");
    await page.close({ runBeforeUnload: true });
    const dialog = await asked;
    expect(dialog.type()).toBe("beforeunload");
    await dialog.dismiss();
    expect(page.isClosed()).toBe(false);
  });

  it("leaves without asking when nothing changed", async () => {
    view = await openRules(saved);
    const { page } = view;
    const asked: string[] = [];
    page.on("dialog", (dialog) => {
      asked.push(dialog.message());
      void dialog.dismiss();
    });
    await page.getByRole("link", { name: "All asks" }).click();
    await page.getByRole("heading", { name: "All clear." }).waitFor();
    expect(asked).toEqual([]);
  });

  it("scrolls only up and down, and makes everything that can be tapped big enough", async () => {
    view = await openRules({ ...saved, readFailed: true });
    const { page } = view;
    await page.getByRole("button", { name: "Try again" }).waitFor();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(phone.width);
    const controls = [
      ...(await page.getByRole("button").all()),
      ...(await page.getByRole("link").all()),
    ];
    for (const control of controls) {
      const box = await control.boundingBox();
      expect(box?.height, await control.innerText()).toBeGreaterThanOrEqual(44);
      expect(box?.width, await control.innerText()).toBeGreaterThanOrEqual(44);
    }
  });
});
