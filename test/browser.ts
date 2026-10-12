// Opens a page in headless Chromium for the browser tier. Any request that is
// not to loopback is refused and recorded, so a test can see that it happened.
//
// The page's API is faked here (ADR 9): a test gives the answer for each
// path, and every call the page makes is recorded with its token.
//
// Headless Chromium always reports a page as visible, so the page's
// visibility is replaced before it loads, and a test hides and shows it.
import { chromium, type Page } from "playwright";
import { z } from "zod";
import { sinceParam, type AsksAnswer } from "../shared/page-api";
import {
  askedForKey,
  emailKey,
  sessionChangedEvent,
  sessionKey,
  spokenKey,
} from "./page/keys";
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
  // What the page asked the browser's speech to read aloud, in order, when
  // the page was opened with speech "recorded".
  spoken(): Promise<string[]>;
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
  // The signed-in person's email address. Left out, Clerk has none for them.
  email?: string;
  // The page's API: each path's answer as JSON, a status alone, or an
  // answer worked out for each call. A path with no answer gets a 404.
  api?: Record<string, unknown>;
  // Give the page Playwright's clock, which runs as usual until a test
  // moves it on with page.clock. Given a time, the clock starts there.
  clock?: boolean | Date;
  // The browser's time zone, such as Europe/London. Without one it is the
  // machine's.
  timeZone?: string;
  // The browser's speech: "absent", as in a browser that cannot speak, or
  // "recorded", which says nothing and records what it was asked to read.
  // Left out, the page has Chromium's own.
  speech?: "absent" | "recorded";
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

// The space between whatever sits above All clear, the header or the tabs,
// and its headline, and between its last line and the foot: the held line
// with the given words, or else the foot of the screen. A missing part
// throws, so a test never measures from 0.
export async function allClearGaps(
  page: Page,
  footText?: string,
): Promise<{ above: number; below: number }> {
  return page.evaluate(async (footText) => {
    await document.fonts.ready;
    const box = (element: Element | null | undefined, name: string) => {
      if (element === null || element === undefined) {
        throw new Error(`All clear has no ${name}`);
      }
      return element.getBoundingClientRect();
    };
    const above = box(
      document.querySelector("main")?.previousElementSibling,
      "header or tabs",
    );
    const headline = box(document.querySelector("h1"), "headline");
    const last = box([...document.querySelectorAll("main p")].at(-1), "line");
    const foot =
      footText === undefined
        ? window.innerHeight
        : box(
            [...document.querySelectorAll("span")].find(
              (span) => span.textContent === footText,
            )?.parentElement,
            "held line",
          ).top;
    return { above: headline.top - above.bottom, below: foot - last.bottom };
  }, footText);
}

// With the page scrolled to its foot, where the note at the foot of the
// screen starts, and where All clear's last line ends, and the held line
// with the given words. A missing part throws.
export async function underTheNote(
  page: Page,
  footText?: string,
): Promise<{ note: number; last: number; held: number | undefined }> {
  return page.evaluate(async (footText) => {
    await document.fonts.ready;
    window.scrollTo(0, document.documentElement.scrollHeight);
    const box = (element: Element | null | undefined, name: string) => {
      if (element === null || element === undefined) {
        throw new Error(`The screen has no ${name}`);
      }
      return element.getBoundingClientRect();
    };
    const note = box(document.querySelector('div[role="status"]'), "note");
    if (note.height === 0) throw new Error("The note is not showing");
    const last = box([...document.querySelectorAll("main p")].at(-1), "line");
    const held =
      footText === undefined
        ? undefined
        : box(
            [...document.querySelectorAll("span")].find(
              (span) => span.textContent === footText,
            )?.parentElement,
            "held line",
          ).bottom;
    return { note: note.top, last: last.bottom, held };
  }, footText);
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
  const context = await browser.newContext({
    viewport,
    ...(options.timeZone === undefined ? {} : { timezoneId: options.timeZone }),
  });
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
  if (options.clock instanceof Date) {
    await context.clock.install({ time: options.clock });
  } else if (options.clock === true) {
    await context.clock.install();
  }
  if (options.speech === "absent") {
    await context.addInitScript(() => {
      Reflect.deleteProperty(window, "speechSynthesis");
      Reflect.deleteProperty(window, "SpeechSynthesisUtterance");
    });
  }
  if (options.speech === "recorded") {
    await context.addInitScript((key) => {
      const spoken: string[] = [];
      Reflect.set(window, key, spoken);
      Object.defineProperty(window, "speechSynthesis", {
        configurable: true,
        value: {
          speak: (utterance: SpeechSynthesisUtterance) => {
            spoken.push(utterance.text);
          },
          cancel: () => undefined,
        },
      });
    }, spokenKey);
  }
  if (options.session !== undefined) {
    await context.addInitScript(
      ([key, token]) => {
        localStorage.setItem(key, token);
      },
      [sessionKey, options.session] as const,
    );
  }
  if (options.email !== undefined) {
    await context.addInitScript(
      ([key, email]) => {
        localStorage.setItem(key, email);
      },
      [emailKey, options.email] as const,
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
    spoken: async () =>
      z.array(z.string()).parse(
        await page.evaluate((key) => {
          const spoken: unknown = Reflect.get(window, key);
          return spoken ?? [];
        }, spokenKey),
      ),
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
    // A route can still be running as the browser closes, such as the guard
    // aborting a link opened in a new tab. Its error would land after the
    // test and fail the run, so the routes go first and their errors with
    // them. Once the browser has closed there are no routes left, so
    // closing again does nothing more.
    close: async () => {
      if (browser.isConnected()) {
        await context.unrouteAll({ behavior: "ignoreErrors" });
      }
      await browser.close();
    },
  };
}
