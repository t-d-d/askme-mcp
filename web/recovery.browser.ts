import { afterEach, describe, expect, inject, it } from "vitest";
import {
  pagePaths,
  samplesPath,
  type AsksAnswer,
  type RulesAnswer,
} from "../shared/page-api";
import {
  Answering,
  answerPoll,
  openPage,
  Status,
  type OpenPage,
} from "../test/browser";
import { pollMs, retryMs } from "./src/poll";
import { signInWaitMs } from "./src/auth";

const phone = { width: 390, height: 844 };
const session = "test-session-token";
const minute = 60_000;

const ask = (
  id: string,
  summary: string,
  postedAt: Date,
  hashtag: string,
): AsksAnswer["asks"][number] => ({
  id,
  summary,
  spokenDetail: `The spoken detail of ${summary}`,
  postedAt: new Date(postedAt.getTime() - 30 * minute).toISOString(),
  opened: false,
  sort: {
    hashtags: [hashtag],
    level: "normal",
    reason: "Sorted for the test.",
  },
});

const listAt = (time: Date): AsksAnswer => ({
  version: 3,
  everAsked: true,
  hashtags: [
    { name: "shop", colour: 1 },
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
  ],
  formerHashtags: [],
  timeZone: "Europe/London",
  asks: [
    ask("a", "Which date format should the export use?", time, "work"),
    ask("b", "Renew the shop's domain?", time, "shop"),
  ],
});

const notConnected = "Not connected. Trying again.";

let view: OpenPage | undefined;
afterEach(async () => {
  await view?.close();
  view = undefined;
});

describe("a browser that goes offline", () => {
  it("says the page is not connected within one poll, and lets a held ask go at its hours", async () => {
    // Tuesday, a minute before work's hours open in London.
    const early = new Date("2026-10-13T06:59:00Z");
    const list = listAt(early);
    view = await openPage(inject("pageUrl"), phone, {
      session,
      clock: early,
      api: {
        [pagePaths.asks]: new Answering((url) => answerPoll(url, list)),
      },
    });
    const { page } = view;
    await page.getByText("1 held until its hours").waitFor();
    await view.offline();
    await page.clock.fastForward(pollMs);
    await page.getByText(notConnected).waitFor();
    await page.clock.fastForward(minute);
    await page
      .getByRole("article")
      .filter({ hasText: "Which date format should the export use?" })
      .waitFor();
    expect(await page.getByText(/held/u).count()).toBe(0);
    expect(await page.getByText(notConnected).count()).toBe(1);
  });
});

const rules: RulesAnswer = {
  text: "#shop is the weekly shop.",
  hashtags: [{ name: "shop", colour: 1 }],
  readFailed: false,
};

describe("a save made offline", () => {
  it("says the rules save did not go through", async () => {
    const list = listAt(new Date());
    view = await openPage(`${inject("pageUrl")}#rules`, phone, {
      session,
      api: {
        [pagePaths.asks]: new Answering((url) => answerPoll(url, list)),
        [pagePaths.rules]: rules,
      },
    });
    const { page } = view;
    const box = page.getByRole("textbox");
    await expect.poll(() => box.inputValue()).toBe(rules.text);
    await box.fill(`${rules.text}\n\n#family is home.`);
    await view.offline();
    await page.getByRole("button", { name: "Save rules" }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "That didn't go through. Try again" })
      .waitFor();
  });

  it("says the sample asks did not go through", async () => {
    view = await openPage(inject("pageUrl"), phone, {
      session,
      api: {
        [pagePaths.asks]: new Answering((url) =>
          answerPoll(url, {
            ...listAt(new Date()),
            everAsked: false,
            asks: [],
          }),
        ),
        [samplesPath]: new Status(204),
      },
    });
    const { page } = view;
    const send = page.getByRole("button", { name: "Send sample asks" });
    await send.waitFor();
    await view.offline();
    await send.click();
    await page
      .getByRole("status")
      .filter({ hasText: "That didn't go through. Try again." })
      .waitFor();
  });
});

describe("sign-in that does not load", () => {
  it("says so after the time limit and offers a reload", async () => {
    view = await openPage(inject("pageUrl"), phone, {
      session,
      clock: "stopped",
      signInStuck: true,
    });
    const { page } = view;
    const reload = page.getByRole("button", { name: "Reload the page" });
    await page.clock.runFor(signInWaitMs - 1000);
    expect(await reload.count()).toBe(0);
    await page.clock.runFor(1000);
    await page.getByText("Sign-in couldn't load.").waitFor();
    await reload.click();
    await expect.poll(() => view?.loads()).toBe(2);
  });
});

describe("an error while rendering", () => {
  it("shows the fallback with a reload, not a blank page", async () => {
    const list = listAt(new Date());
    view = await openPage(inject("pageUrl"), phone, {
      session,
      api: {
        [pagePaths.asks]: new Answering((url) => answerPoll(url, list)),
      },
    });
    const { page } = view;
    await page.getByRole("article").waitFor();
    await view.breakRendering();
    await page.getByText("This page stopped working.").waitFor();
    expect(await page.getByRole("article").count()).toBe(0);
    await page.getByRole("button", { name: "Reload the page" }).waitFor();
  });
});

// As after a deploy that changes the poll's answer: the list first, then
// answers in a shape this page does not know.
const changingAnswer = async () => {
  const list = listAt(new Date());
  let readable = true;
  const opened = await openPage(inject("pageUrl"), phone, {
    session,
    clock: true,
    api: {
      [pagePaths.asks]: new Answering((url) =>
        readable ? answerPoll(url, list) : { version: 4, shape: "new" },
      ),
    },
  });
  await opened.page.getByRole("article").waitFor();
  return {
    opened,
    readable: (now: boolean) => {
      readable = now;
    },
  };
};

describe("a poll answer the page cannot read", () => {
  it("reloads the page once, then says the page is not connected", async () => {
    const { opened, readable } = await changingAnswer();
    view = opened;
    const { page } = view;
    readable(false);
    await page.clock.fastForward(pollMs);
    await expect.poll(() => view?.loads()).toBe(2);
    await page.getByText(notConnected).waitFor();
    const polls = () =>
      view?.apiCalls.filter(({ path }) => path === pagePaths.asks).length;
    // A poll still out when the next falls due is not sent twice, so the
    // clock moves on until three more have gone.
    const after = (polls() ?? 0) + 3;
    await expect
      .poll(async () => {
        await page.clock.fastForward(pollMs);
        return polls();
      })
      .toBeGreaterThanOrEqual(after);
    await page.getByText(notConnected).waitFor();
    expect(view.loads()).toBe(2);
  });

  it("reloads again for a later failure once a poll has been read", async () => {
    const { opened, readable } = await changingAnswer();
    view = opened;
    const { page } = view;
    readable(false);
    await page.clock.fastForward(pollMs);
    await expect.poll(() => view?.loads()).toBe(2);
    await page.getByText(notConnected).waitFor();
    readable(true);
    await page.clock.fastForward(pollMs);
    await page.getByRole("article").waitFor();
    readable(false);
    await page.clock.fastForward(pollMs);
    await expect.poll(() => view?.loads()).toBe(3);
  });
});

// The rules opened while the service is down, so their load is tried again.
// Then the service comes back after a deploy that changes the rules' answer,
// and the poll's too when pollChanges.
const rulesAfterDeploy = async (pollChanges: boolean) => {
  const list = listAt(new Date());
  let deployed = false;
  const opened = await openPage(`${inject("pageUrl")}#rules`, phone, {
    session,
    clock: true,
    api: {
      [pagePaths.asks]: new Answering((url) =>
        deployed && pollChanges
          ? { version: 4, shape: "new" }
          : answerPoll(url, list),
      ),
      [pagePaths.rules]: new Answering(() =>
        deployed ? { shape: "new" } : new Status(503),
      ),
    },
  });
  await opened.page
    .getByRole("status")
    .filter({ hasText: notConnected })
    .waitFor();
  deployed = true;
  return opened;
};

const rulesLoads = (opened: OpenPage) =>
  opened.apiCalls.filter(({ path }) => path === pagePaths.rules).length;

// Each load is tried again at retryMs while it fails.
async function staysAfterRetries(opened: OpenPage): Promise<void> {
  const after = rulesLoads(opened) + 3;
  await expect
    .poll(async () => {
      await opened.page.clock.fastForward(retryMs);
      return rulesLoads(opened);
    })
    .toBeGreaterThanOrEqual(after);
  expect(opened.loads()).toBe(2);
}

describe("a rules answer the page cannot read", () => {
  it("reloads the page once, then says the page is not connected", async () => {
    view = await rulesAfterDeploy(false);
    const opened = view;
    await expect
      .poll(async () => {
        await opened.page.clock.fastForward(retryMs);
        return opened.loads();
      })
      .toBe(2);
    await opened.page
      .getByRole("status")
      .filter({ hasText: notConnected })
      .waitFor();
    await staysAfterRetries(opened);
  });

  it("reloads once in all when the poll cannot be read either", async () => {
    view = await rulesAfterDeploy(true);
    const opened = view;
    await expect
      .poll(async () => {
        await opened.page.clock.fastForward(retryMs);
        return opened.loads();
      })
      .toBe(2);
    await staysAfterRetries(opened);
  });
});

describe("a poll answer the page cannot read, beside rules it can", () => {
  it("reloads once, as reading the rules does not clear the poll's mark", async () => {
    const list = listAt(new Date());
    let deployed = false;
    view = await openPage(`${inject("pageUrl")}#rules`, phone, {
      session,
      clock: true,
      api: {
        [pagePaths.asks]: new Answering((url) =>
          deployed ? { version: 4, shape: "new" } : answerPoll(url, list),
        ),
        [pagePaths.rules]: rules,
      },
    });
    const opened = view;
    const { page } = opened;
    const box = page.getByRole("textbox");
    await expect.poll(() => box.inputValue()).toBe(rules.text);
    deployed = true;
    await page.clock.fastForward(pollMs);
    await expect.poll(() => opened.loads()).toBe(2);
    // The page after the reload reads the rules.
    await expect.poll(() => box.inputValue()).toBe(rules.text);
    const polls = () =>
      opened.apiCalls.filter(({ path }) => path === pagePaths.asks).length;
    const after = polls() + 3;
    await expect
      .poll(async () => {
        await page.clock.fastForward(pollMs);
        return polls();
      })
      .toBeGreaterThanOrEqual(after);
    expect(opened.loads()).toBe(2);
  });
});

describe("a reload the person cancels", () => {
  it("does not stop a later reload for an answer the page cannot read", async () => {
    const list = listAt(new Date());
    let deployed = false;
    view = await openPage(`${inject("pageUrl")}#rules`, phone, {
      session,
      clock: true,
      api: {
        [pagePaths.asks]: new Answering((url) =>
          deployed ? { version: 4, shape: "new" } : answerPoll(url, list),
        ),
        [pagePaths.rules]: rules,
      },
    });
    const opened = view;
    const { page } = opened;
    const box = page.getByRole("textbox");
    await expect.poll(() => box.inputValue()).toBe(rules.text);
    await box.fill(`${rules.text}\n\n#family is home.`);
    const asked: string[] = [];
    page.once("dialog", (dialog) => {
      asked.push(dialog.type());
      void dialog.dismiss();
    });
    deployed = true;
    await page.clock.fastForward(pollMs);
    await expect.poll(() => asked).toEqual(["beforeunload"]);
    expect(opened.loads()).toBe(1);
    page.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await expect
      .poll(async () => {
        await page.clock.fastForward(pollMs);
        return opened.loads();
      })
      .toBe(2);
    // The page after the reload finds the first page's mark.
    const polls = () =>
      opened.apiCalls.filter(({ path }) => path === pagePaths.asks).length;
    const after = polls() + 3;
    await expect
      .poll(async () => {
        await page.clock.fastForward(pollMs);
        return polls();
      })
      .toBeGreaterThanOrEqual(after);
    expect(opened.loads()).toBe(2);
  });
});
