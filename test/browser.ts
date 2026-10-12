// Opens a page in headless Chromium for the browser tier. Any request that is
// not to loopback is refused and recorded, so a test can see that it happened.
//
// The page's API is faked here (ADR 9): a test gives the answer for each
// path, and every call the page makes is recorded with its token.
//
// Headless Chromium always reports a page as visible, so the page's
// visibility is replaced before it loads, and a test hides and shows it.
import { chromium, type Page } from "playwright";
import { sinceParam, type AsksAnswer } from "../shared/page-api";
import { askedForKey, sessionChangedEvent, sessionKey } from "./page/keys";
import { isLoopbackHost } from "./loopback";

export interface ApiCall {
  method: string;
  path: string;
  // The query string, such as "?since=5", or "" for none.
  query: string;
  authorization: string | null;
  // What the page sent, such as the rules it saved, or null for none.
  body: string | null;
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
  // Sign in with another session token, or out with null, without a
  // reload, as Clerk does when another tab signs in or out.
  signInAs(session: string | null): Promise<void>;
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

// An answer that is a status, such as a failure, with a JSON body when one
// is given, such as a refusal.
export class Status {
  constructor(
    readonly code: number,
    readonly body?: unknown,
  ) {}
}

// An answer worked out for each call, from the address the page asked for,
// the Authorization header it sent, and its method and body. It may give
// JSON or a status, at once or after a while.
export class Answering {
  constructor(
    readonly answer: (
      url: URL,
      authorization: string | null,
      sent: { method: string; body: string | null },
    ) => unknown,
  ) {}
}

// Answers a poll for the list as the service does: with nothing new when it
// carries the list's version, and with the whole list otherwise.
export function answerPoll(url: URL, list: AsksAnswer): unknown {
  return url.searchParams.get(sinceParam) === String(list.version)
    ? { version: list.version, unchanged: true }
    : list;
}

// A colour, or a custom property that holds one, as the page's browser
// computes it. A test compares an element's colour with this, so no colour
// is written in a test of the page (styling.md).
export async function computedColour(
  page: Page,
  colour: string,
): Promise<string> {
  return page.evaluate((value) => {
    const probe = document.createElement("span");
    probe.style.color = value;
    document.body.append(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    return computed;
  }, colour);
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
      const request = route.request();
      const url = new URL(request.url());
      const authorization = await request.headerValue("authorization");
      const sent = { method: request.method(), body: request.postData() };
      apiCalls.push({
        ...sent,
        path: url.pathname,
        query: url.search,
        authorization,
      });
      const given = options.api?.[url.pathname];
      const answer: unknown =
        given instanceof Answering
          ? await given.answer(url, authorization, sent)
          : given;
      if (answer === undefined) {
        await route.fulfill({ status: 404 });
      } else if (answer instanceof Status) {
        await route.fulfill(
          answer.body === undefined
            ? { status: answer.code }
            : { status: answer.code, json: answer.body },
        );
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
    signInAs: (session) =>
      page.evaluate(
        ([key, event, token]) => {
          if (token === null) localStorage.removeItem(key);
          else localStorage.setItem(key, token);
          window.dispatchEvent(new Event(event));
        },
        [sessionKey, sessionChangedEvent, session] as const,
      ),
    close: () => browser.close(),
  };
}
