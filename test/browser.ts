// Opens a page in headless Chromium for the browser tier. Any request that is
// not to loopback is refused and recorded, so a test can see that it happened.
//
// The page's API is faked here (ADR 9): a test gives the answer for each
// path, and every call the page makes is recorded with its token.
import { chromium, type Page } from "playwright";
import { askedForKey, sessionKey } from "./page/keys";
import { isLoopbackHost } from "./loopback";

export interface ApiCall {
  path: string;
  authorization: string | null;
}

export interface OpenPage {
  page: Page;
  refused: string[];
  apiCalls: ApiCall[];
  // Which of Clerk's screens the page asked for, if any.
  askedFor(): Promise<string | null>;
  close(): Promise<void>;
}

export interface PageOptions {
  // Signed in with this session token. Signed out when it is not set.
  session?: string;
  // The page's API: each path's answer as JSON, or a status alone. A path
  // with no answer gets a 404.
  api?: Record<string, unknown>;
}

// An answer that is only a status, such as a failure.
export class Status {
  constructor(readonly code: number) {}
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
      const { pathname } = new URL(route.request().url());
      apiCalls.push({
        path: pathname,
        authorization: await route.request().headerValue("authorization"),
      });
      const answer = options.api?.[pathname];
      if (answer === undefined) {
        await route.fulfill({ status: 404 });
      } else if (answer instanceof Status) {
        await route.fulfill({ status: answer.code });
      } else {
        await route.fulfill({ json: answer });
      }
    },
  );
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
    close: () => browser.close(),
  };
}
