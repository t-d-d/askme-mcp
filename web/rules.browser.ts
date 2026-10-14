import { afterEach, describe, expect, inject, it } from "vitest";
import {
  pagePaths,
  type AsksAnswer,
  type RulesAnswer,
} from "../shared/page-api";
import { pageAsk } from "../test/asks";
import {
  Answering,
  computedColour,
  datedPolls,
  openPage,
  Status,
  stepUntil,
  stepUntilShown,
  type OpenPage,
} from "../test/browser";
import { palette } from "./src/palette";
import { pollMs } from "./src/poll";
import { resetTime } from "./src/resets";

const phone = { width: 390, height: 844 };
const session = "test-session-token";
const email = "sam@example.com";
const minute = 60_000;

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
  formerHashtags: [],
  asks: [],
};

const behindUntil = (
  sortingUntil: string,
  postedAt = new Date(Date.parse(sortingUntil) - 30 * minute).toISOString(),
): AsksAnswer["asks"][number] =>
  pageAsk({
    id: "a",
    summary: "Renew the shop's domain?",
    spokenDetail: "The domain lapses on Friday.",
    postedAt,
    sortingUntil,
  });

const behind = (offset: number): AsksAnswer => ({
  ...list,
  asks: [
    behindUntil(
      new Date(Date.now() + offset).toISOString(),
      new Date(Date.now() - 60 * minute).toISOString(),
    ),
  ],
});

async function openRules(
  rules: RulesAnswer | Answering,
  viewport = phone,
  timeZone = "Europe/London",
  asks: AsksAnswer = list,
): Promise<OpenPage> {
  const view = await openPage(`${inject("pageUrl")}#rules`, viewport, {
    session,
    email,
    timeZone,
    api: { [pagePaths.rules]: rules, [pagePaths.asks]: asks },
  });
  await view.page
    .getByRole("heading", { name: "Your rules", exact: true })
    .waitFor();
  return view;
}

const rulesApi = (
  loaded: RulesAnswer,
  onSave: (body: string | null) => unknown,
) =>
  new Answering((_, __, sent) =>
    sent.method === "PUT" ? onSave(sent.body) : loaded,
  );

// The moment is by the service's clock.
async function wakesSaveRulesAt(
  moment: string,
  serviceAhead: number,
  asks: AsksAnswer,
  line: string,
): Promise<void> {
  const here = Date.parse(moment) - serviceAhead;
  let pageAt = here - 2 * minute;
  view = await openPage(inject("pageUrl"), phone, {
    session,
    email,
    timeZone: "Europe/London",
    clock: { stoppedAt: new Date(pageAt) },
    api: {
      [pagePaths.rules]: saved,
      [pagePaths.asks]: datedPolls(
        () => asks,
        () => pageAt + serviceAhead,
      ),
    },
  });
  const { page } = view;
  await stepUntilShown(page, page.getByText(line, { exact: true }));
  await page.getByRole("link", { name: "Rules" }).click();
  const save = page.getByRole("button", { name: "Save rules" });
  await stepUntil(
    page,
    async () => (await page.getByRole("textbox").inputValue()) === text,
    "the rules to load",
  );
  expect(await save.isDisabled()).toBe(true);
  pageAt = here + pollMs;
  await page.clock.pauseAt(new Date(pageAt));
  await stepUntil(page, () => save.isEnabled(), "Save rules to wake");
}

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

  it("makes Save rules ink while asks couldn't be sorted, and saves the same text, saying it sorts them again", async () => {
    const bodies: (string | null)[] = [];
    view = await openRules(
      rulesApi(saved, async (body) => {
        bodies.push(body);
        await sleep(500);
        return saved;
      }),
      phone,
      "Europe/London",
      behind(-60_000),
    );
    const { page } = view;
    const save = page.getByRole("button", { name: "Save rules" });
    await expect.poll(() => save.isEnabled()).toBe(true);
    expect(
      await save.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ).toBe(await computedColour(page, "var(--ink)"));
    // The button is awake, so the note does not say it waits for a change.
    expect(await page.getByText("Saved.", { exact: true }).isVisible()).toBe(
      true,
    );
    await save.click();
    await page.getByText("Sorting your asks again.").waitFor();
    expect(bodies).toEqual([
      JSON.stringify({ text, timeZone: await browserZone(page) }),
    ]);
    expect(await page.getByText("Reading your rules.").count()).toBe(0);
  });

  it("drops the note that asks are being sorted again once a later poll finds some stopped", async () => {
    // Stopped, then being sorted after the save, then stopped again.
    let answer = behind(-60_000);
    view = await openPage(`${inject("pageUrl")}#rules`, phone, {
      session,
      email,
      timeZone: "Europe/London",
      api: {
        [pagePaths.rules]: rulesApi(saved, () => {
          answer = behind(60_000);
          return saved;
        }),
        [pagePaths.asks]: new Answering(() => answer),
      },
    });
    const { page } = view;
    const save = page.getByRole("button", { name: "Save rules" });
    await expect.poll(() => save.isEnabled()).toBe(true);
    await save.click();
    await page.getByText("Sorting your asks again.").waitFor();
    await expect.poll(() => save.isDisabled()).toBe(true);
    answer = behind(-60_000);
    await page
      .getByText("Saved.", { exact: true })
      .waitFor({ timeout: 15_000 });
    expect(await save.isEnabled()).toBe(true);
    expect(await page.getByText("Sorting your asks again.").count()).toBe(0);
  });

  it("drops the note that asks are being sorted again once a later poll finds today's sorting limit reached", async () => {
    let answer = behind(-60_000);
    view = await openPage(`${inject("pageUrl")}#rules`, phone, {
      session,
      email,
      timeZone: "Europe/London",
      api: {
        [pagePaths.rules]: rulesApi(saved, () => {
          answer = behind(60_000);
          return saved;
        }),
        [pagePaths.asks]: new Answering(() => answer),
      },
    });
    const { page } = view;
    const save = page.getByRole("button", { name: "Save rules" });
    await expect.poll(() => save.isEnabled()).toBe(true);
    await save.click();
    await page.getByText("Sorting your asks again.").waitFor();
    answer = {
      ...behind(60_000),
      version: 2,
      modelCapResetsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    };
    await page
      .getByText("Saved. The button wakes up when you change the text.")
      .waitFor({ timeout: 15_000 });
    expect(await save.isDisabled()).toBe(true);
  });

  it("keeps Save rules neutral while asks are still being sorted", async () => {
    view = await openRules(saved, phone, "Europe/London", behind(60_000));
    const { page } = view;
    await page.getByText("Saved.", { exact: false }).waitFor();
    // The list has loaded, and says the ask is still being sorted.
    await expect
      .poll(() => view?.apiCalls.some(({ path }) => path === pagePaths.asks))
      .toBe(true);
    expect(
      await page.getByRole("button", { name: "Save rules" }).isDisabled(),
    ).toBe(true);
  });

  it("keeps Save rules neutral while asks couldn't be sorted and today's sorting limit is reached, until the text changes", async () => {
    view = await openRules(saved, phone, "Europe/London", {
      ...behind(-60_000),
      modelCapResetsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    });
    const { page } = view;
    await expect
      .poll(() => view?.apiCalls.some(({ path }) => path === pagePaths.asks))
      .toBe(true);
    await page
      .getByText("Saved. The button wakes up when you change the text.")
      .waitFor();
    const save = page.getByRole("button", { name: "Save rules" });
    expect(await save.isDisabled()).toBe(true);
    expect(
      await save.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ).toBe(await computedColour(page, "var(--neutral-tint)"));
    await page.getByRole("textbox").fill(`${text}\n\n#family is home.`);
    expect(await save.isEnabled()).toBe(true);
  });

  it("says today's limit is reached, and when it resets, when the save is refused at the cap, and keeps the text", async () => {
    const changed = `${text}\n\n#family is home.`;
    view = await openRules(
      rulesApi(
        saved,
        () =>
          new Status(429, {
            code: "cap_reached",
            class: "do not retry",
            message: "Saving these rules needs model calls.",
          }),
      ),
    );
    const { page } = view;
    await page.getByRole("textbox").fill(changed);
    await page.getByRole("button", { name: "Save rules" }).click();
    await page
      .getByText(
        `You've reached today's limit. It resets at ${resetTime(Date.now(), "Europe/London")}.`,
      )
      .waitFor();
    expect(await page.getByRole("textbox").inputValue()).toBe(changed);
    expect(await rows(page)).toEqual([
      "#work\nWeekdays, 8am to 6pm",
      "#shop\nAny time",
    ]);
  });

  it("drops the cap note once the cap resets, with no reload, and keeps the text", async () => {
    const changed = `${text}\n\n#family is home.`;
    view = await openPage(`${inject("pageUrl")}#rules`, phone, {
      session,
      email,
      timeZone: "Europe/London",
      clock: new Date("2026-10-12T15:00:00Z"),
      api: {
        [pagePaths.rules]: rulesApi(
          saved,
          () =>
            new Status(429, {
              code: "cap_reached",
              class: "do not retry",
              message: "Saving these rules needs model calls.",
            }),
        ),
        [pagePaths.asks]: list,
      },
    });
    const { page } = view;
    const capNote = page
      .getByRole("status")
      .filter({ hasText: "You've reached today's limit. It resets at 01:00." });
    await page.getByRole("textbox").fill(changed);
    await page.getByRole("button", { name: "Save rules" }).click();
    await capNote.waitFor();
    await page.clock.pauseAt(new Date("2026-10-12T23:59:59Z"));
    expect(await capNote.count()).toBe(1);
    await page.clock.runFor(2000);
    await expect.poll(() => capNote.count()).toBe(0);
    expect(await page.getByRole("textbox").inputValue()).toBe(changed);
  });

  // The refusal's Date header puts the service's clock at 23:58 UTC, two
  // minutes before the cap resets.
  it.each([
    ["fast", "2026-10-13T00:01:00Z", "2026-10-13T00:03:00Z"],
    ["slow", "2026-10-12T23:55:00Z", "2026-10-12T23:57:00Z"],
  ])(
    "drops the cap note when the service's day ends, on a clock a few minutes %s",
    async (_, pressed, reset) => {
      view = await openPage(`${inject("pageUrl")}#rules`, phone, {
        session,
        email,
        timeZone: "Europe/London",
        clock: { stoppedAt: new Date(pressed) },
        api: {
          [pagePaths.rules]: rulesApi(
            saved,
            () =>
              new Status(
                429,
                {
                  code: "cap_reached",
                  class: "do not retry",
                  message: "Saving these rules needs model calls.",
                },
                { date: "Mon, 12 Oct 2026 23:58:00 GMT" },
              ),
          ),
          [pagePaths.asks]: list,
        },
      });
      const { page } = view;
      const box = page.getByRole("textbox");
      const capNote = page.getByRole("status").filter({
        hasText: "You've reached today's limit. It resets at 01:00.",
      });
      await stepUntil(page, () => box.isEnabled(), "the rules to load");
      await box.fill(`${text}\n\n#family is home.`);
      await page.getByRole("button", { name: "Save rules" }).click();
      await stepUntilShown(page, capNote);
      await page.clock.pauseAt(new Date(Date.parse(reset) - 1000));
      expect(await capNote.count()).toBe(1);
      await page.clock.runFor(2000);
      await expect.poll(() => capNote.count()).toBe(0);
    },
  );

  it.each([
    ["fast", -3 * minute],
    ["slow", 3 * minute],
  ])(
    "wakes Save rules when the service's day ends, on a clock a few minutes %s",
    async (_, serviceAhead) => {
      const resets = "2026-10-13T00:00:00.000Z";
      await wakesSaveRulesAt(
        resets,
        serviceAhead,
        {
          ...list,
          modelCapResetsAt: resets,
          asks: [behindUntil("2026-10-12T21:30:00.000Z")],
        },
        "Today's sorting limit is reached. It resets at 01:00.",
      );
    },
  );

  it.each([
    ["fast", -3 * minute],
    ["slow", 3 * minute],
  ])(
    "wakes Save rules when the service's time for an ask that couldn't be sorted comes, on a clock a few minutes %s",
    async (_, serviceAhead) => {
      const turns = "2026-10-12T18:30:00.000Z";
      await wakesSaveRulesAt(
        turns,
        serviceAhead,
        { ...list, asks: [behindUntil(turns)] },
        "Sorting 1 ask with your rules",
      );
    },
  );

  it("does not say asks are being sorted again once the cap note goes, after the cap refused an unchanged save", async () => {
    // One ask that couldn't be sorted, which closes while the save is
    // refused, so no ask is stopped when the cap resets.
    let answer: AsksAnswer = {
      ...list,
      asks: [
        pageAsk({
          id: "a",
          summary: "Renew the shop's domain?",
          spokenDetail: "The domain lapses on Friday.",
          postedAt: "2026-10-12T13:00:00.000Z",
          sortingUntil: "2026-10-12T14:00:00.000Z",
        }),
      ],
    };
    view = await openPage(`${inject("pageUrl")}#rules`, phone, {
      session,
      email,
      timeZone: "Europe/London",
      clock: new Date("2026-10-12T15:00:00Z"),
      api: {
        [pagePaths.rules]: rulesApi(saved, () => {
          answer = { ...list, version: 2 };
          return new Status(429, {
            code: "cap_reached",
            class: "do not retry",
            message: "Saving these rules needs model calls.",
          });
        }),
        [pagePaths.asks]: new Answering(() => answer),
      },
    });
    const { page } = view;
    const capNote = page
      .getByRole("status")
      .filter({ hasText: "You've reached today's limit. It resets at 01:00." });
    const save = page.getByRole("button", { name: "Save rules" });
    await expect.poll(() => save.isEnabled()).toBe(true);
    await save.click();
    await capNote.waitFor();
    // A poll after the refusal finds the ask closed.
    const polls = () =>
      view?.apiCalls.filter(({ path }) => path === pagePaths.asks).length ?? 0;
    const before = polls();
    await page.clock.runFor(pollMs + 1000);
    await expect.poll(polls).toBeGreaterThan(before);
    await page.clock.pauseAt(new Date("2026-10-12T23:59:59Z"));
    await page.clock.runFor(2000);
    await expect.poll(() => capNote.count()).toBe(0);
    expect(await page.getByText("Sorting your asks again.").count()).toBe(0);
    expect(await page.getByRole("status").allInnerTexts()).toEqual([
      "Saved. The button wakes up when you change the text.",
    ]);
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

  it("says when a save did not go through, keeps the text, and offers to try again", async () => {
    const changed = `${text}\n\n#family is home.`;
    const bodies: (string | null)[] = [];
    view = await openRules(
      rulesApi(saved, (body) => {
        bodies.push(body);
        return new Status(503);
      }),
    );
    const { page } = view;
    await page.getByRole("textbox").fill(changed);
    await page.getByRole("button", { name: "Save rules" }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "That didn't go through. Try again" })
      .waitFor();
    expect(await page.getByRole("textbox").inputValue()).toBe(changed);
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

  // A limit's note says when to try instead.
  it.each([
    [
      "rate_limited",
      "retry",
      "Slow down a little. Try again in a few seconds.",
    ],
    ["cap_reached", "do not retry", "You've reached today's limit."],
  ])(
    "offers no Try again button when a save is refused with %s",
    async (code, retries, words) => {
      view = await openRules(
        rulesApi(
          saved,
          () => new Status(429, { code, class: retries, message: "No." }),
        ),
      );
      const { page } = view;
      await page.getByRole("textbox").fill("#work");
      await page.getByRole("button", { name: "Save rules" }).click();
      await page.getByRole("status").filter({ hasText: words }).waitFor();
      expect(
        await page.getByRole("button", { name: "Try again" }).count(),
      ).toBe(0);
    },
  );

  it("says that saving changed rules re-sorts every open ask, and saving them unchanged sorts again any that couldn't be sorted", async () => {
    view = await openRules(saved);
    const read = view.page.getByRole("region", {
      name: "askme read this from your rules",
    });
    await read.getByRole("listitem").first().waitFor();
    expect(await read.innerText()).toContain(
      "Saving changed rules re-sorts every open ask, and saving them unchanged sorts again any that couldn't be sorted.",
    );
  });

  it("says what saving sorts while the rules load", async () => {
    view = await openPage(`${inject("pageUrl")}#rules`, phone, {
      session,
      api: {
        [pagePaths.rules]: new Answering(async () => {
          await sleep(5000);
          return saved;
        }),
        [pagePaths.asks]: list,
      },
    });
    const { page } = view;
    await page
      .getByRole("heading", { name: "Your rules", exact: true })
      .waitFor();
    expect(
      await page
        .getByText("Saving changed rules re-sorts every open ask", {
          exact: false,
        })
        .isVisible(),
    ).toBe(true);
    expect(await page.getByText("Hours use").count()).toBe(0);
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
    // The page puts #rules back only once the dismissal reaches it.
    await expect.poll(() => new URL(page.url()).hash).toBe("#rules");
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
    // The page puts #rules back only once the dismissal reaches it.
    await expect.poll(() => new URL(page.url()).hash).toBe("#rules");
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

  // Chromium asks before a tab closes only on a page someone has used, and
  // only once the page has told it of a beforeunload listener. The page adds
  // the listener as Save rules turns on, so the test waits for that first.
  it("asks before the tab closes with unsaved text", async () => {
    view = await openRules(saved);
    const { page } = view;
    const box = page.getByRole("textbox");
    const save = page.getByRole("button", { name: "Save rules" });
    await box.click();
    await box.fill("#work only.");
    await expect.poll(() => save.isEnabled()).toBe(true);
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

describe("signing out", () => {
  const headline = "Your agents ask here. You decide what gets through.";

  it("names the account at the foot of the rules, with Sign out beside it", async () => {
    view = await openRules(saved);
    const { page } = view;
    const account = page.getByText(email, { exact: true });
    const signOut = page.getByRole("button", { name: "Sign out" });
    expect(await account.isVisible()).toBe(true);
    expect(await signOut.isVisible()).toBe(true);
    const footnote = await page
      .getByText("Saving changed rules re-sorts every open ask", {
        exact: false,
      })
      .boundingBox();
    const [named, button] = await Promise.all([
      account.boundingBox(),
      signOut.boundingBox(),
    ]);
    expect(named?.y).toBeGreaterThan(footnote?.y ?? Infinity);
    expect(button?.x).toBeGreaterThan(named?.x ?? Infinity);
  });

  it("offers Sign out alone when Clerk has no email address for the account", async () => {
    view = await openPage(`${inject("pageUrl")}#rules`, phone, {
      session,
      api: { [pagePaths.rules]: saved, [pagePaths.asks]: list },
    });
    const { page } = view;
    const signOut = page.getByRole("button", { name: "Sign out" });
    await signOut.waitFor();
    expect(await signOut.locator("..").innerText()).toBe("Sign out");
  });

  async function footFor(address: string) {
    view = await openPage(`${inject("pageUrl")}#rules`, phone, {
      session,
      email: address,
      api: { [pagePaths.rules]: saved, [pagePaths.asks]: list },
    });
    const { page } = view;
    const account = page.getByText(address, { exact: true });
    const signOut = page.getByRole("button", { name: "Sign out" });
    await account.waitFor();
    const [named, button] = await Promise.all([
      account.boundingBox(),
      signOut.boundingBox(),
    ]);
    if (named === null || button === null) {
      throw new Error("The foot showed no account or no Sign out.");
    }
    const line = await account.evaluate((element) =>
      parseFloat(getComputedStyle(element).lineHeight),
    );
    expect(button.y).toBeLessThan(named.y + named.height);
    expect(named.y).toBeLessThan(button.y + button.height);
    expect(button.x).toBeGreaterThanOrEqual(named.x + named.width);
    return { page, named, line };
  }

  // Longer than a common address, such as a 23-letter Gmail one.
  it("keeps an address of 30 characters on one line, with Sign out beside it", async () => {
    const { named, line } = await footFor("samantha.okonkwo-r@example.com");
    expect(named.height).toBeLessThan(2 * line);
  });

  it("wraps a long address beside Sign out, with no sideways scroll", async () => {
    const { page, named, line } = await footFor(
      "samantha.okonkwo-richardson.accounts-payable@example-company.com",
    );
    expect(named.height).toBeGreaterThanOrEqual(2 * line);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(phone.width);
  });

  it("signs out through Clerk and shows the signed-out page, with no screen in the address", async () => {
    view = await openRules(saved);
    const { page } = view;
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("heading", { level: 1, name: headline }).waitFor();
    expect(await view.askedFor()).toBe("sign-out");
    expect(
      await page.getByRole("button", { name: "Sign in" }).isVisible(),
    ).toBe(true);
    expect(new URL(page.url()).hash).toBe("");
  });

  it("asks before signing out with unsaved text, and stays signed in when told to", async () => {
    view = await openRules(saved);
    const { page } = view;
    const box = page.getByRole("textbox");
    await box.fill("#work only.");
    const asked: string[] = [];
    page.once("dialog", (dialog) => {
      asked.push(dialog.message());
      void dialog.dismiss();
    });
    await page.getByRole("button", { name: "Sign out" }).click();
    expect(asked).toEqual(["Leave without saving your rules?"]);
    expect(await view.askedFor()).toBeNull();
    expect(await box.inputValue()).toBe("#work only.");
    expect(new URL(page.url()).hash).toBe("#rules");
    page.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("heading", { level: 1, name: headline }).waitFor();
    expect(await view.askedFor()).toBe("sign-out");
  });
});
