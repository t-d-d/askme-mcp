// The live check's steps on the signed-in page, apart from signing in, so
// the browser tier can rehearse them against a faked API (ADR 26).
import type { Page } from "playwright";
import { expect } from "vitest";
import {
  askChange,
  askChangePaths,
  pagePaths,
  pollAnswer,
  refusalAnswer,
  samplesPath,
  type AsksAnswer,
  type PageAsk,
} from "../shared/page-api";
import { cardHref } from "../web/src/screen";

// One for each sample area.
export const sampleCount = 3;

export interface Waits {
  // For one thing the page does.
  stepMs: number;
  // From the press until every sample shows as sorted.
  sortMs: number;
}

// The newest full answer the page has had to its polls, from the page at
// origin. An answer that says nothing changed is left out.
export function watchAnswers(
  page: Page,
  origin: string,
): () => AsksAnswer | undefined {
  let answer: AsksAnswer | undefined;
  page.context().on("response", (response) => {
    const url = new URL(response.url());
    if (
      url.origin !== origin ||
      url.pathname !== pagePaths.asks ||
      response.request().method() !== "GET" ||
      !response.ok()
    ) {
      return;
    }
    void response
      .json()
      .then((body) => {
        const read = pollAnswer.parse(body);
        if ("asks" in read && read.version >= (answer?.version ?? -1)) {
          answer = read;
        }
      })
      .catch(() => undefined);
  });
  return () => answer;
}

// Starts on Connect your agents, and ends on the list. It checks that each
// sample was sorted, not how, since the model is not deterministic. It
// returns the asks it posted.
export async function sendSortAndDismiss(
  page: Page,
  answer: () => AsksAnswer | undefined,
  { stepMs, sortMs }: Waits,
): Promise<PageAsk[]> {
  // The page's answer is read apart from the page, so it can come a moment
  // after the list shows.
  await expect
    .poll(answer, {
      timeout: stepMs,
      message: "The page read no list before the samples.",
    })
    .toBeDefined();
  const before = new Set(answer()?.asks.map(({ id }) => id));
  const [sent] = await Promise.all([
    page
      .waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === samplesPath,
        { timeout: stepMs },
      )
      .catch(failsWith(page, "Send sample asks sent nothing.")),
    page
      .getByRole("button", { name: "Send sample asks", exact: true })
      .click({ timeout: stepMs })
      .catch(
        failsWith(page, "Connect your agents showed no Send sample asks."),
      ),
  ]);
  const sortedBy = Date.now() + sortMs;
  if (!sent.ok()) {
    const refused = refusalAnswer.safeParse(
      await sent.json().catch(() => undefined),
    );
    throw new Error(
      `The service refused the sample asks with ${String(sent.status())}. ${refused.success ? refused.data.message : "Its answer said nothing more."}`,
    );
  }
  const fresh = () =>
    (answer()?.asks ?? []).filter(({ id }) => !before.has(id));
  // The service answers 204 when it posted any sample, so an area whose
  // samples were all sent in the last ten minutes shows as fewer here.
  await expect
    .poll(() => fresh().length, { timeout: stepMs })
    .toBe(sampleCount)
    .catch(() => {
      const seen = fresh().map(({ summary }) => summary);
      throw new Error(
        `The list showed ${String(seen.length)} new asks after Send sample asks, not ${String(sampleCount)}: ${seen.join("; ") || "none"}.`,
      );
    });
  const posted = fresh();
  const ids = new Set(posted.map(({ id }) => id));
  // What the sorting line counts: an ask with a sortingUntil.
  const unsorted = () =>
    (answer()?.asks ?? [])
      .filter(
        ({ id, sort, sortingUntil }) =>
          ids.has(id) && (sort === null || sortingUntil !== undefined),
      )
      .map(({ summary }) => summary);
  await expect
    .poll(unsorted, { timeout: Math.max(sortedBy - Date.now(), 1) })
    .toEqual([])
    .catch(() => {
      throw new Error(
        `Not every sample ask was sorted within ${String(sortMs / 1000)} seconds of the press. Still not sorted: ${unsorted().join("; ")}.`,
      );
    });
  for (const { id, summary } of posted) {
    await dismissSorted(page, id, summary, stepMs);
  }
  return posted;
}

// The card opens by its address, not its link, so it is not marked opened.
// The page sends the dismissal when the note with Undo goes.
async function dismissSorted(
  page: Page,
  id: string,
  summary: string,
  stepMs: number,
): Promise<void> {
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, cardHref(id));
  const card = page.getByRole("main").filter({
    has: page.getByRole("heading", { level: 1, name: summary, exact: true }),
  });
  await card
    .waitFor({ timeout: stepMs })
    .catch(failsWith(page, `The card for "${summary}" did not open.`));
  await card
    .getByText("Not sorted yet", { exact: true })
    .waitFor({ state: "detached", timeout: stepMs })
    .catch(
      failsWith(page, `The card for "${summary}" still showed Not sorted yet.`),
    );
  const [sent] = await Promise.all([
    page
      .waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === askChangePaths.dismissed &&
          dismissedId(response.request().postData()) === id,
        { timeout: stepMs },
      )
      .catch(failsWith(page, `The page sent no dismissal for "${summary}".`)),
    page
      .getByRole("button", { name: "Dismiss", exact: true })
      .click({ timeout: stepMs })
      .catch(failsWith(page, `The card for "${summary}" showed no Dismiss.`)),
  ]);
  expect(sent.ok(), `The service refused to dismiss "${summary}".`).toBe(true);
}

// The id a dismissal names, from its body as sent. A body that is not JSON
// names none, so a listener that reads it does not throw.
export function dismissedId(body: string | null): string {
  try {
    return askChange.safeParse(JSON.parse(body ?? "")).data?.id ?? "(no id)";
  } catch {
    return "(no id)";
  }
}

export function failsWith(page: Page, message: string) {
  return async (error: unknown): Promise<never> => {
    throw new Error(`${message} It showed: ${await screen(page)}`, {
      cause: error,
    });
  };
}

export async function screen(page: Page): Promise<string> {
  const words = await page
    .locator("body")
    .innerText({ timeout: 1000 })
    .catch(() => "(nothing readable)");
  return words.replace(/\s+/gu, " ").slice(0, 500);
}
