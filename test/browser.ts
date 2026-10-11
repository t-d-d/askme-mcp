// Opens a page in headless Chromium for the browser tier. Any request that is
// not to loopback is refused and recorded, so a test can see that it happened.
//
// The page's API is faked here (ADR 9): a test gives the answer for each
// path, and every call the page makes is recorded with its token.
//
// Headless Chromium always reports a page as visible, so the page's
// visibility is replaced before it loads, and a test hides and shows it.
import { chromium, type Page } from "playwright";
import { askedForKey, sessionKey } from "./page/keys";
import { isLoopbackHost } from "./loopback";

export interface ApiCall {
  path: string;
  // The query string, such as "?since=5", or "" for none.
  query: string;
  authorization: string | null;
}

export interface OpenPage {
  page: Page;
  refused: string[];
  apiCalls: ApiCall[];
  // Which of Clerk's screens the page asked for, if any.
  askedFor(): Promise<string | null>;
  // Hide or show the page, as switching tabs or locking the phone would.
  hide(): Promise<void>;
  show(): Promise<void>;
  close(): Promise<void>;
}

export interface PageOptions {
  // Signed in with this session token. Signed out when it is not set.
  session?: string;
  // The page's API: each path's answer as JSON, a status alone, or an
  // answer worked out for each call. A path with no answer gets a 404.
  api?: Record<string, unknown>;
  // Give the page Playwright's clock, which runs as usual until a test
  // moves it on with page.clock.
  clock?: boolean;
}

// An answer that is only a status, such as a failure.
export class Status {
  constructor(readonly code: number) {}
}

// An answer worked out for each call, from the address the page asked for.
// It may give JSON or a status.
export class Answering {
  constructor(readonly answer: (url: URL) => unknown) {}
}

const hiddenFlag = "testHidden";

// Sets the flag the replaced visibility reads, and tells the page, as the
// browser does when a tab is hidden or shown.
async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate(
    ([flag, value]) => {
      document.documentElement.dataset[flag] = String(value);
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    },
    [hiddenFlag, hidden] as const,
  );
}

export async function openPage(
  url: string,
  viewport: { width: number; height: number },
  options: PageOptions = {},
): Promise<OpenPage> {
  // Chromium cannot resolve any outside host, in case a request gets past
  // the route below.
  const browser = await chromium.launch({
    args: [
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
    ],
  });
  const context = await browser.newContext({ viewport });
  const refused: string[] = [];
  await context.route("**/*", async (route) => {
    const target = new URL(route.request().url());
    if (isLoopbackHost(target.hostname)) {
      await route.continue();
    } else {
      refused.push(target.href);
      await route.abort("blockedbyclient");
    }
  });
  const apiCalls: ApiCall[] = [];
  // Registered after the guard, so it is tried first.
  await context.route(
    (target) =>
      isLoopbackHost(target.hostname) && target.pathname.startsWith("/api/"),
    async (route) => {
      const url = new URL(route.request().url());
      apiCalls.push({
        path: url.pathname,
        query: url.search,
        authorization: await route.request().headerValue("authorization"),
      });
      const given = options.api?.[url.pathname];
      const answer = given instanceof Answering ? given.answer(url) : given;
      if (answer === undefined) {
        await route.fulfill({ status: 404 });
      } else if (answer instanceof Status) {
        await route.fulfill({ status: answer.code });
      } else {
        await route.fulfill({ json: answer });
      }
    },
  );
  await context.addInitScript((flag) => {
    const hidden = () => document.documentElement.dataset[flag] === "true";
    Object.defineProperty(Document.prototype, "hidden", {
      configurable: true,
      get: hidden,
    });
    Object.defineProperty(Document.prototype, "visibilityState", {
      configurable: true,
      get: () => (hidden() ? "hidden" : "visible"),
    });
  }, hiddenFlag);
  if (options.clock === true) await context.clock.install();
  if (options.session !== undefined) {
    await context.addInitScript(
      ([key, token]) => {
        localStorage.setItem(key, token);
      },
      [sessionKey, options.session] as const,
    );
  }
  const page = await context.newPage();
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  return {
    page,
    refused,
    apiCalls,
    askedFor: () =>
      page.evaluate((key) => sessionStorage.getItem(key), askedForKey),
    hide: () => setHidden(page, true),
    show: () => setHidden(page, false),
    close: () => browser.close(),
  };
}
