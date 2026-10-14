import { afterEach, describe, expect, inject, it } from "vitest";
import { pagePaths, type AsksAnswer } from "../shared/page-api";
import { pageAsk } from "../test/asks";
import {
  Answering,
  answerPoll,
  openPage,
  type OpenPage,
  type PageOptions,
} from "../test/browser";
import { watchViolations } from "../test/live-page";

// The page as built, under the CSP the deploy sends (ADR 28). Clerk is faked
// here, so this sees what the page's own code needs. The live check sees
// what Clerk's scripts need.

const phone = { width: 390, height: 844 };
const session = "test-session-token";
const summary = "Merge the fix for checkout rounding? Tests pass.";

const list: AsksAnswer = {
  version: 3,
  everAsked: true,
  hashtags: [{ name: "work", colour: 0 }],
  formerHashtags: [],
  asks: [
    pageAsk({
      id: "a",
      summary,
      postedAt: new Date(Date.now() - 31 * 60_000).toISOString(),
      sort: { hashtags: ["work"], level: "normal", reason: "It is work." },
    }),
  ],
};

let view: OpenPage | undefined;

afterEach(async () => {
  await view?.close();
  view = undefined;
});

// openPage has loaded the page already, so it loads again with the watch on.
async function watched(options: PageOptions = {}) {
  view = await openPage(inject("pageUrl"), phone, options);
  const heard = await watchViolations(
    view.page.context(),
    new URL(inject("pageUrl")).origin,
  );
  const response = await view.page.reload();
  return { page: view.page, heard, response };
}

describe("fitness: the built page breaks no CSP rule (content-security-policy.md)", () => {
  it("is served here with the CSP the deploy sends", async () => {
    const { response } = await watched();
    const { header, value } = inject("pageCsp");
    expect(response?.headers()[header]).toBe(value);
  });

  it("breaks no rule on the signed-out page", async () => {
    const { page, heard } = await watched();
    await page.getByRole("button", { name: "Sign in" }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    expect(heard()).toEqual([]);
  });

  it("breaks no rule on the list, a card, the rules and Connect your agents", async () => {
    const { page, heard } = await watched({
      session,
      api: {
        [pagePaths.asks]: new Answering((url) => answerPoll(url, list)),
        [pagePaths.connection]: {
          mcpUrl: "https://abc123.execute-api.us-east-1.amazonaws.com/mcp",
        },
        [pagePaths.rules]: { text: "", hashtags: [], readFailed: false },
      },
    });
    await page.getByRole("article").waitFor();
    await page.getByText(summary, { exact: true }).click();
    await page.getByRole("heading", { level: 1, name: summary }).waitFor();
    await page.getByRole("link", { name: "All asks" }).click();
    await page.getByRole("link", { name: "Rules", exact: true }).click();
    await page
      .getByRole("heading", { name: "Your rules", exact: true })
      .waitFor();
    await page.getByRole("link", { name: "Connect agents" }).click();
    await page
      .getByRole("heading", { name: "Connect your agents", exact: true })
      .waitFor();
    await page.evaluate(() => document.fonts.ready);
    expect(heard()).toEqual([]);
  });
});
