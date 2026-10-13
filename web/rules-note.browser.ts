import { afterEach, describe, expect, inject, it } from "vitest";
import { pagePaths, type AsksAnswer } from "../shared/page-api";
import { openPage, Status, type OpenPage } from "../test/browser";

const phone = { width: 390, height: 844 };
const session = "test-session-token";

const list: AsksAnswer = {
  version: 1,
  everAsked: true,
  hashtags: [],
  formerHashtags: [],
  asks: [],
};

let view: OpenPage | undefined;
afterEach(async () => {
  await view?.close();
  view = undefined;
});

describe("rules that cannot be loaded", () => {
  it("says the page is not connected, and keeps the box and Save rules asleep", async () => {
    view = await openPage(`${inject("pageUrl")}#rules`, phone, {
      session,
      timeZone: "Europe/London",
      api: { [pagePaths.rules]: new Status(503), [pagePaths.asks]: list },
    });
    const { page } = view;
    await page
      .getByRole("heading", { name: "Your rules", exact: true })
      .waitFor();
    await page
      .getByRole("status")
      .filter({ hasText: "Not connected. Trying again." })
      .waitFor();
    expect(await page.getByRole("textbox").isDisabled()).toBe(true);
    expect(
      await page.getByRole("button", { name: "Save rules" }).isDisabled(),
    ).toBe(true);
    expect(await page.getByRole("button", { name: "Try again" }).count()).toBe(
      0,
    );
  });
});
