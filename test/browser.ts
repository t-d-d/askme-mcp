// Opens a page in headless Chromium for the browser tier. Any request that is
// not to loopback is refused and recorded, so a test can see that it happened.
//
// The page's API is faked here (ADR 9): a test gives the answer for each
// path, and every call the page makes is recorded with its token.
//
// Headless Chromium always reports a page as visible, so the page's
// visibility is replaced before it loads, and a test hides and shows it.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Locator, type Page } from "playwright";
import { expect, inject } from "vitest";
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
  // "stopped", it stands still from before the page loads, and moves only
  // when a test moves it on. Stopped at a time, it stands still there.
  clock?: boolean | Date | "stopped" | { stoppedAt: Date };
  // The browser's time zone, such as Europe/London. Without one it is the
  // machine's.
  timeZone?: string;
  // The browser's speech: "absent", as in a browser that cannot speak, or
  // "recorded", which says nothing and records what it was asked to read.
  // Left out, the page has Chromium's own.
  speech?: "absent" | "recorded";
}

// An answer that is a status, such as a failure, with a JSON body when one
// is given, such as a refusal, and any headers given, such as the Date the
// service's clock gave it.
export class Status {
  constructor(
    readonly code: number,
    readonly body?: unknown,
    readonly headers?: Record<string, string>,
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

// Every file of the page as test/page-server.ts built it.
export async function builtFiles(): Promise<string[]> {
  const dir = inject("pageDir");
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

// Moves a page's stopped clock on a millisecond at a time until a check
// holds, so the page's own timers run as they fall due, such as the one
// React Query waits on before it draws an answer. The page's requests take
// real time, which the stopped clock does not count. Steps are at least
// 10ms of real time apart, so in the wait's 10 seconds the clock moves on a
// second at most. An error thrown by one of the page's timers as the clock
// moves fails the test.
export async function stepUntil(
  page: Page,
  holds: () => Promise<boolean>,
  what: string,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await holds())) {
    expect(Date.now(), `${what} within 10 seconds`).toBeLessThan(deadline);
    await page.clock.runFor(1);
    await new Promise((waited) => setTimeout(waited, 10));
  }
}

// Steps a page's stopped clock, as above, until a part of the page shows.
export const stepUntilShown = (page: Page, part: Locator): Promise<void> =>
  stepUntil(page, async () => (await part.count()) > 0, "the part to show");

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
// and its headline, and between its last line and the foot: the line at
// the foot with the given words, held, lapsed or sorting, or else the foot of
// the screen. A missing part
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
            "line at the foot",
          ).top;
    return { above: headline.top - above.bottom, below: foot - last.bottom };
  }, footText);
}

// With the page scrolled to its foot, where the note at the foot of the
// screen starts, and where All clear's last line ends, and the line at the
// foot with the given words. A missing part throws.
export async function underTheNote(
  page: Page,
  footText?: string,
): Promise<{ note: number; last: number; foot: number | undefined }> {
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
    const foot =
      footText === undefined
        ? undefined
        : box(
            [...document.querySelectorAll("span")].find(
              (span) => span.textContent === footText,
            )?.parentElement,
            "line at the foot",
          ).bottom;
    return { note: note.top, last: last.bottom, foot };
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
        await route.fulfill({
          status: answer.code,
          ...(answer.body === undefined ? {} : { json: answer.body }),
          ...(answer.headers === undefined ? {} : { headers: answer.headers }),
        });
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
  } else if (options.clock !== undefined && options.clock !== false) {
    // Paused before there is a page, so it stops at this time exactly. A
    // page's clock is running by the time a test could pause it, and a
    // pause at a time already gone is refused.
    const start =
      options.clock === "stopped" ? new Date() : options.clock.stoppedAt;
    await context.clock.install({ time: start });
    await context.clock.pauseAt(start);
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
