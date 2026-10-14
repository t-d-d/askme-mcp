import { afterEach, describe, expect, inject, it } from "vitest";
import {
  pagePaths,
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
import { pollMs } from "../web/src/poll";

const phone = { width: 390, height: 844 };
const session = "test-session-token";
const notConnected = "Not connected. Trying again.";

// What API Gateway answers, itself, to a request over the stage's throttle
// (ADR 30). It carries none of askme's refusal codes.
const throttled = () => new Status(429, { message: "Too Many Requests" });

const list: AsksAnswer = {
  version: 1,
  everAsked: true,
  hashtags: [],
  formerHashtags: [],
  asks: [
    {
      id: "a",
      summary: "Which date format should the export use?",
      spokenDetail: "The spoken detail of the date format.",
      postedAt: new Date().toISOString(),
      opened: false,
      sort: null,
    },
  ],
};

const rules: RulesAnswer = {
  text: "#shop is the weekly shop.",
  hashtags: [{ name: "shop", colour: 1 }],
  readFailed: false,
};

let view: OpenPage | undefined;
afterEach(async () => {
  await view?.close();
  view = undefined;
});

describe("fitness: a throttled page says it is not connected and recovers (api-throttle.md)", () => {
  it("says it is not connected while its polls are throttled, and clears the note when one passes", async () => {
    let throttling = false;
    view = await openPage(inject("pageUrl"), phone, {
      session,
      clock: true,
      api: {
        [pagePaths.asks]: new Answering((url) =>
          throttling ? throttled() : answerPoll(url, list),
        ),
      },
    });
    const { page } = view;
    const card = page.getByRole("article");
    await card.waitFor();
    throttling = true;
    await page.clock.fastForward(pollMs);
    await page.getByText(notConnected).waitFor();
    expect(await card.count()).toBe(1);
    throttling = false;
    await page.clock.fastForward(pollMs);
    await expect.poll(() => page.getByText(notConnected).count()).toBe(0);
    expect(await card.count()).toBe(1);
  });

  it("says a throttled rules save did not go through", async () => {
    view = await openPage(`${inject("pageUrl")}#rules`, phone, {
      session,
      api: {
        [pagePaths.asks]: new Answering((url) => answerPoll(url, list)),
        [pagePaths.rules]: new Answering((_url, _authorization, { method }) =>
          method === "PUT" ? throttled() : rules,
        ),
      },
    });
    const { page } = view;
    const box = page.getByRole("textbox");
    await expect.poll(() => box.inputValue()).toBe(rules.text);
    await box.fill(`${rules.text}\n\n#family is home.`);
    await page.getByRole("button", { name: "Save rules" }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "That didn't go through. Try again" })
      .waitFor();
  });
});
