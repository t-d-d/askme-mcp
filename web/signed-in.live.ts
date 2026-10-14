import {
  chromium,
  type Browser,
  type Locator,
  type Page,
  type Response,
} from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  askChangePaths,
  pagePaths,
  samplesPath,
  type PageAsk,
} from "../shared/page-api";
import { mcpUrl, pageUrl, phone } from "../test/live";
import {
  dismissedId,
  failsWith,
  sampleCount,
  screen,
  sendSortAndDismiss,
  watchAnswers,
} from "../test/live-page";

// Clerk's test mode verifies a +clerk_test address with the code 424242 and
// sends no email. The address may be public, and is used as it is, never
// built on: the instance holds only 100 accounts (ADR 16).
const testAddress = "askme-live+clerk_test@example.com";
const testCode = "424242";

const stepMs = 30_000;

// A sort that fails once comes back after the queue's six-minute visibility
// timeout, so this leaves room for the second try (ADR 26).
const sortMs = 8 * 60_000;

// Clerk's Frontend API. A screen starts an attempt with a POST to signIns or
// signUps, then asks for the code to be sent with a POST under it.
const signIns = "/v1/client/sign_ins";
const signUps = "/v1/client/sign_ups";
const sendCode = /\/prepare_(?:first_factor|verification)$/u;

const refusal = z.object({
  errors: z
    .array(
      z.object({
        code: z.string(),
        message: z.string().optional(),
        long_message: z.string().optional(),
      }),
    )
    .min(1),
});

const signUpAnswer = z.object({
  response: z.object({
    email_address: z.string().nullable(),
    missing_fields: z.array(z.string()).optional(),
  }),
});

describe("fitness: a person can sign in on the live page (test-tiers.md)", () => {
  let browser: Browser | undefined;
  let page: Page;
  // Heard on the context, so calls from a worker the page starts count too.
  const apiCalls: string[] = [];
  const dismissed: string[] = [];
  let answer: ReturnType<typeof watchAnswers>;
  let posted: PageAsk[] = [];

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: phone });
    const { origin } = new URL(pageUrl());
    page.context().on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin === origin && url.pathname.startsWith("/api/")) {
        apiCalls.push(`${request.method()} ${url.pathname}`);
      }
      if (url.origin === origin && url.pathname === askChangePaths.dismissed) {
        dismissed.push(dismissedId(request.postData()));
      }
    });
    answer = watchAnswers(page, origin);
    await page.goto(pageUrl());
    await signIn(page);
  }, 5 * stepMs);

  afterAll(async () => {
    await browser?.close();
  });

  it(
    "leaves the signed-out page for the account's list",
    async () => {
      const shown = page
        .getByRole("article")
        .or(page.getByRole("heading", { name: "Your agents can ask here." }))
        .or(page.getByRole("heading", { name: "All clear." }));
      const notConnected = page.getByText("Not connected. Trying again.");
      await shown
        .first()
        .waitFor({ timeout: stepMs })
        .catch(
          failsWith(
            page,
            "The signed-in page showed no list, no new-account card and no All clear.",
          ),
        );
      expect(await notConnected.isVisible()).toBe(false);
      expect(await page.getByRole("button", { name: "Sign in" }).count()).toBe(
        0,
      );
    },
    2 * stepMs,
  );

  // On a phone the header links only to the rules, which link on to Connect
  // your agents. Opening the rules only reads them.
  it(
    "shows the MCP address the deploy published under Connect your agents",
    async () => {
      await page
        .getByRole("link", { name: "Rules", exact: true })
        .click({ timeout: stepMs })
        .catch(failsWith(page, "The header showed no way to the rules."));
      await page
        .getByRole("link", { name: "Connect agents" })
        .click({ timeout: stepMs })
        .catch(
          failsWith(page, "The rules screen showed no Connect agents link."),
        );
      await expect
        .poll(() => page.getByLabel("Server address").inputValue(), {
          timeout: stepMs,
        })
        .toBe(mcpUrl());
      expect(
        await page.getByText("Not connected. Trying again.").isVisible(),
      ).toBe(false);
    },
    4 * stepMs,
  );

  // Starts on Connect your agents, where the step above left the page.
  describe("fitness: sample asks are sorted on the live site (test-tiers.md)", () => {
    it(
      "sends sample asks, sees each one sorted, and dismisses them",
      async () => {
        posted = await sendSortAndDismiss(page, answer, { stepMs, sortMs });
      },
      // The press, the new asks, then the card, its sort and its dismissal
      // for each sample, with room to spare.
      sortMs + (4 + 3 * sampleCount) * stepMs,
    );
  });

  // The sample step ends on the list, whose header links to the rules. When
  // it fails it may leave Connect your agents or a card open, which link only
  // to All asks, so the run still signs out. The reload shows Clerk ended the
  // session, so the run leaves none behind.
  it(
    "signs out from the rules and shows the signed-out page",
    async () => {
      const allAsks = page.getByRole("link", { name: "All asks" });
      if (await allAsks.isVisible()) {
        await allAsks
          .click({ timeout: stepMs })
          .catch(failsWith(page, "The All asks link did not respond."));
      }
      await page
        .getByRole("link", { name: "Rules", exact: true })
        .click({ timeout: stepMs })
        .catch(failsWith(page, "The header showed no way to the rules."));
      const account = page.getByText(testAddress, { exact: true });
      await account
        .waitFor({ timeout: stepMs })
        .catch(
          failsWith(page, "The rules did not name the signed-in account."),
        );
      expect(await account.innerText()).toBe(testAddress);
      await page.getByRole("button", { name: "Sign out" }).click();
      const signIn = page.getByRole("button", { name: "Sign in" });
      await signIn
        .waitFor({ timeout: stepMs })
        .catch(failsWith(page, "Sign out did not show the signed-out page."));
      await page.reload();
      await signIn
        .waitFor({ timeout: stepMs })
        .catch(failsWith(page, "A reload after signing out was signed in."));
    },
    4 * stepMs,
  );

  // Runs last, so it sees every call the steps above made (ADR 20,
  // ADR 26).
  describe("fitness: the signed-in check writes only its samples (test-tiers.md)", () => {
    it("sends the page's API reads, one press of the samples and their dismissals", () => {
      const reads = Object.values(pagePaths).map((path) => `GET ${path}`);
      expect(apiCalls).toContain(`GET ${pagePaths.asks}`);
      expect(apiCalls.filter((call) => !reads.includes(call)).sort()).toEqual(
        [
          `POST ${samplesPath}`,
          ...posted.map(() => `POST ${askChangePaths.dismissed}`),
        ].sort(),
      );
      expect(posted).toHaveLength(sampleCount);
      expect([...dismissed].sort()).toEqual(posted.map(({ id }) => id).sort());
    });
  });
});

async function signIn(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign in" }).click();
  let attempt = await giveAddress(
    page,
    page.locator('input[name="identifier"]'),
    signIns,
  );
  if (!attempt.answer.ok()) {
    const [error] = refusal.parse(await attempt.answer.json()).errors;
    if (error?.code !== "form_identifier_not_found") {
      throw new Error(`Clerk refused the sign-in. ${said(error)}`);
    }
    attempt = await signUp(page);
  }
  await giveCode(page, attempt.codeSent);
  await landBack(page);
}

async function signUp(page: Page): Promise<Attempt> {
  await page.goto(pageUrl());
  await page.getByRole("button", { name: "Sign up" }).click();
  const attempt = await giveAddress(
    page,
    page.locator('input[name="emailAddress"]'),
    signUps,
  );
  if (!attempt.answer.ok()) {
    const [error] = refusal.parse(await attempt.answer.json()).errors;
    throw new Error(`Clerk refused the sign-up. ${said(error)}`);
  }
  const { response } = signUpAnswer.parse(await attempt.answer.json());
  expect(response.email_address).toBe(testAddress);
  const more = response.missing_fields ?? [];
  if (more.length > 0) {
    throw new Error(
      `Clerk's sign-up asks for more than the address and the code: ${more.join(", ")}. Going on needs a new decision (ADR 16).`,
    );
  }
  return attempt;
}

// codeSent is undefined when the screen does not ask for the code within
// two steps: one for Clerk to answer the attempt, one for the code screen.
interface Attempt {
  answer: Response;
  codeSent: Promise<Response | undefined>;
}

// The wait for the code to be sent starts before Continue is pressed, so a
// quick answer is not missed.
async function giveAddress(
  page: Page,
  field: Locator,
  path: string,
): Promise<Attempt> {
  await field.waitFor({ timeout: stepMs });
  await field.fill(testAddress);
  const codeSent = page
    .waitForResponse(
      (response) => {
        const { pathname } = new URL(response.url());
        return (
          response.request().method() === "POST" &&
          pathname.startsWith(`${path}/`) &&
          sendCode.test(pathname)
        );
      },
      { timeout: 2 * stepMs },
    )
    .catch(() => undefined);
  const [answer] = await Promise.all([
    page
      .waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === path,
        { timeout: stepMs },
      )
      .catch(failsWith(page, "Clerk's screen sent nothing after Continue.")),
    page.getByRole("button", { name: "Continue", exact: true }).click(),
  ]);
  return { answer, codeSent };
}

// The field is one box, or one per digit that typing into the first fills.
// Clerk takes the code once the last digit is in, and refuses digits typed
// before it has sent the code.
async function giveCode(
  page: Page,
  codeSent: Attempt["codeSent"],
): Promise<void> {
  const field = page
    .getByRole("textbox", { name: "verification code" })
    .or(page.locator('input[autocomplete="one-time-code"]'))
    .first();
  const sent = await codeSent;
  if (sent === undefined) {
    throw new Error(
      `Clerk's screen did not ask for the code to be sent. It showed: ${await screen(page)}`,
    );
  }
  if (!sent.ok()) {
    const [error] = refusal.parse(await sent.json()).errors;
    throw new Error(`Clerk did not send the code. ${said(error)}`);
  }
  await field
    .waitFor({ timeout: stepMs })
    .catch(failsWith(page, "Clerk's screen asked for no code."));
  await field.click();
  await page.keyboard.type(testCode);
}

async function landBack(page: Page): Promise<void> {
  const { origin } = new URL(pageUrl());
  await page
    .waitForURL((url) => url.origin === origin, { timeout: stepMs })
    .catch(failsWith(page, "Clerk did not send the page back after the code."));
}

function said(error: z.infer<typeof refusal>["errors"][number] | undefined) {
  const what = `${error?.code ?? "no code"}: ${error?.long_message ?? error?.message ?? "no message"}`;
  return /captcha|\bbot\b/iu.test(what)
    ? `${what}. Its bot check blocked the run, and getting past it needs Clerk's secret key or a dashboard step, which ADR 16 leaves to a new decision.`
    : what;
}
