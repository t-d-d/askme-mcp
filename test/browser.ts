import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Locator, type Page } from "playwright";
import { expect, inject } from "vitest";
import { z } from "zod";
import { sinceParam, type AsksAnswer } from "../shared/page-api";
import {
  askedForKey,
  brokenKey,
  emailKey,
  sessionChangedEvent,
  sessionKey,
  signInStuckKey,
  spokenKey,
} from "./page/keys";
import { isLoopbackHost } from "./loopback";

export interface ApiCall {
  method: string;
  path: string;
  // url.search: "?since=5", or "" for none.
  query: string;
  authorization: string | null;
  body: string | null;
}

export interface OpenPage {
  page: Page;
  refused: string[];
  apiCalls: ApiCall[];
  // Which of Clerk's screens the page asked for.
  askedFor(): Promise<string | null>;
  // Needs the page opened with speech "recorded".
  spoken(): Promise<string[]>;
  hide(): Promise<void>;
  show(): Promise<void>;
  // Without a reload, as Clerk does when another tab signs in or out.
  signInAs(session: string | null): Promise<void>;
  // Takes the browser offline. Playwright still routes requests made
  // offline, so the stand-in API fails them as Chromium would.
  offline(): Promise<void>;
  // How many times a document has loaded in the page, the first included.
  loads(): number;
  // Makes the next render throw.
  breakRendering(): Promise<void>;
  close(): Promise<void>;
}

export interface PageOptions {
  session?: string;
  email?: string;
  // By path: JSON, a Status or an Answering. Any other path gets a 404.
  api?: Record<string, unknown>;
  // true runs Playwright's clock from now, and a Date runs it from then.
  // "stopped" stands still from before the page loads, and stoppedAt stands
  // still at that time. A stopped clock moves only when a test moves it.
  clock?: boolean | Date | "stopped" | { stoppedAt: Date };
  timeZone?: string;
  // "recorded" says nothing and records what it was asked to read. Left
  // out, the page has Chromium's own.
  speech?: "absent" | "recorded";
  // Left out, the device asks for reduced motion, so a test can tap as soon
  // as a screen shows: taps are lost while screens slide.
  motion?: boolean;
  // true leaves sign-in loading, as when Clerk cannot be reached.
  signInStuck?: boolean;
}

export class Status {
  constructor(
    readonly code: number,
    readonly body?: unknown,
    readonly headers?: Record<string, string>,
  ) {}
}

// The answer may be JSON or a Status, or a promise of either.
export class Answering {
  constructor(
    readonly answer: (
      url: URL,
      authorization: string | null,
      sent: { method: string; body: string | null },
    ) => unknown,
  ) {}
}

// The page as test/page-server.ts built it.
export async function builtFiles(): Promise<string[]> {
  const dir = inject("pageDir");
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

// Moves a stopped clock on 1ms per step, so the page's timers run as they
// fall due. Steps are 10ms of real time apart, for the page's requests,
// which the stopped clock does not count, so in the 10 second wait the
// clock moves a second at most.
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

export const stepUntilShown = (page: Page, part: Locator): Promise<void> =>
  stepUntil(page, async () => (await part.count()) > 0, "the part to show");

// Answers a poll as the service does.
export function answerPoll(url: URL, list: AsksAnswer): unknown {
  return url.searchParams.get(sinceParam) === String(list.version)
    ? { version: list.version, unchanged: true }
    : list;
}

export const datedPolls = (
  list: () => AsksAnswer,
  serviceNow: () => number,
): Answering =>
  new Answering(
    (url) =>
      new Status(200, answerPoll(url, list()), {
        date: new Date(serviceNow()).toUTCString(),
      }),
  );

export function failingPolls(
  list: () => AsksAnswer,
  serviceNow: () => number,
): { answering: Answering; fail: () => void } {
  const dated = datedPolls(list, serviceNow);
  let failing = false;
  return {
    answering: new Answering((url, authorization, sent) =>
      failing ? new Status(503) : dated.answer(url, authorization, sent),
    ),
    fail: () => {
      failing = true;
    },
  };
}

// Moves Date.now() and leaves performance.now() as it was, as a device does
// when it puts its clock right or, on most systems, when it sleeps.
export async function moveDeviceClock(page: Page, by: number): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  await page.clock.setSystemTime(now + by);
}

// A test compares against this, from the palette or a token, and writes no
// colour of its own (styling.md).
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

// The foot is the line with footText, or else the bottom of the screen. A
// missing part throws, so a test never measures from 0.
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
    reducedMotion: options.motion === true ? "no-preference" : "reduce",
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
  let offline = false;
  // Registered after the guard, so it is tried first.
  await context.route(
    (target) =>
      isLoopbackHost(target.hostname) && target.pathname.startsWith("/api/"),
    async (route) => {
      if (offline) {
        await route.abort("internetdisconnected");
        return;
      }
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
  // Headless Chromium always reports a page as visible.
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
    // Paused before there is a page: by the time a test could pause it, the
    // clock has run on, and a pause at a time already gone is refused.
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
  if (options.signInStuck === true) {
    await context.addInitScript((key) => {
      localStorage.setItem(key, "true");
    }, signInStuckKey);
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
  let loads = 0;
  page.on("load", () => {
    loads += 1;
  });
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
    offline: async () => {
      offline = true;
      await context.setOffline(true);
    },
    loads: () => loads,
    breakRendering: () =>
      page.evaluate(
        ([key, event]) => {
          localStorage.setItem(key, "true");
          window.dispatchEvent(new Event(event));
        },
        [brokenKey, sessionChangedEvent] as const,
      ),
    // A route still running as the browser closes, such as the guard
    // aborting a link opened in a new tab, would throw after the test and
    // fail the run, so the routes go first.
    close: async () => {
      if (browser.isConnected()) {
        await context.unrouteAll({ behavior: "ignoreErrors" });
      }
      await browser.close();
    },
  };
}
