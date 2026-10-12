// After each deploy, the one test account signs in on the live page through
// Clerk's own screens, as a person does, and the signed-in page loads its
// list (ADR 16). The first run, and any run after the account is deleted,
// signs it up. The page only reads, so nothing here writes to askme's store.
import {
  chromium,
  type Browser,
  type Locator,
  type Page,
  type Response,
} from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { mcpUrl, pageUrl, phone } from "../test/live";

// The one test account. Clerk's test mode verifies a +clerk_test address
// with the code 424242, and sends it no email. Anyone may read the address:
// the account holds nothing that matters (ADR 16).
const testAddress = "askme-live+clerk_test@example.com";
const testCode = "424242";

// How long one of Clerk's screens, or one answer from Clerk, may take.
const stepMs = 30_000;

// Clerk's screens start a sign-in or a sign-up with a POST to its Frontend
// API, and Clerk answers there. Once Clerk has taken the address, the screen
// asks for the code to be sent with a POST to the attempt it started.
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

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: phone });
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

  it(
    "shows the MCP address the deploy published under Connect your agents",
    async () => {
      await page
        .getByRole("link", { name: "Connect agents" })
        .click({ timeout: stepMs });
      await expect
        .poll(() => page.getByLabel("Server address").inputValue(), {
          timeout: stepMs,
        })
        .toBe(mcpUrl());
      expect(
        await page.getByText("Not connected. Trying again.").isVisible(),
      ).toBe(false);
    },
    3 * stepMs,
  );
});

// Signs in from the signed-out page, on Clerk's screens, and lands back on
// the page. When Clerk says the account does not exist, it signs up with the
// same address. Any other answer from Clerk fails the check.
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

// An attempt that one of Clerk's screens started: Clerk's answer to it, and
// Clerk's answer when the screen asks for the code to be sent, or undefined
// if the screen did not ask within a step's time.
interface Attempt {
  answer: Response;
  codeSent: Promise<Response | undefined>;
}

// Gives the address on one of Clerk's screens, presses Continue, and returns
// the attempt that starts. The wait for the code to be sent starts before
// Continue is pressed, so a quick answer is not missed.
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
      { timeout: stepMs },
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

// Clerk's field for the code: one box, or one box per digit, where typing
// into the first fills the rest. Clerk goes on once the last digit is in, so
// the code is typed only after Clerk has sent it. Typed sooner, Clerk takes
// the digits before the code exists and refuses them.
async function giveCode(
  page: Page,
  codeSent: Attempt["codeSent"],
): Promise<void> {
  const field = page
    .getByRole("textbox", { name: "verification code" })
    .or(page.locator('input[autocomplete="one-time-code"]'))
    .first();
  await field
    .waitFor({ timeout: stepMs })
    .catch(failsWith(page, "Clerk's screen asked for no code."));
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
  await field.click();
  await page.keyboard.type(testCode);
}

async function landBack(page: Page): Promise<void> {
  const { origin } = new URL(pageUrl());
  await page
    .waitForURL((url) => url.origin === origin, { timeout: stepMs })
    .catch(failsWith(page, "Clerk did not send the page back after the code."));
}

// What Clerk said, and what to do when its bot check said it.
function said(error: z.infer<typeof refusal>["errors"][number] | undefined) {
  const what = `${error?.code ?? "no code"}: ${error?.long_message ?? error?.message ?? "no message"}`;
  return /captcha|\bbot\b/iu.test(what)
    ? `${what}. Its bot check blocked the run, and getting past it needs Clerk's secret key or a dashboard step, which ADR 16 leaves to a new decision.`
    : what;
}

// A step's failure, told with what the page showed at the time.
function failsWith(page: Page, message: string) {
  return async (error: unknown): Promise<never> => {
    throw new Error(`${message} It showed: ${await screen(page)}`, {
      cause: error,
    });
  };
}

// The words on the page, for a failure's message.
async function screen(page: Page): Promise<string> {
  const words = await page
    .locator("body")
    .innerText({ timeout: 1000 })
    .catch(() => "(nothing readable)");
  return words.replace(/\s+/gu, " ").slice(0, 500);
}
