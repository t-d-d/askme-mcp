import { afterEach, describe, expect, inject, it } from "vitest";
import { openPage, type OpenPage } from "./browser";
import { watchViolations, type Violation } from "./live-page";

// The live check's watch for CSP violations, from test/live-page.ts, against
// pages served here with a CSP of their own (ADR 28). The live tier runs it
// against the deployed page.

const phone = { width: 390, height: 844 };
const probe = "/csp-probe";

// An image and an inline script, each with a token in its address or text,
// as a Clerk address can carry one.
const body = `<!doctype html><title>probe</title><img src="/csp-probe.png?token=secret"><script>document.title = "secret";</script>`;

let view: OpenPage | undefined;

afterEach(async () => {
  await view?.close();
  view = undefined;
});

async function serve(
  page: OpenPage["page"],
  url: string,
  headers: Record<string, string>,
) {
  await page.route(url, (route) =>
    route.fulfill({ contentType: "text/html", headers, body }),
  );
}

const byPlace = (heard: Violation[]) =>
  [...heard].sort((a, b) =>
    `${a.page} ${a.directive}`.localeCompare(`${b.page} ${b.directive}`),
  );

describe("the live check's watch for CSP violations", () => {
  it("hears report-only and enforced violations on the page's own address, without query strings", async () => {
    view = await openPage(inject("pageUrl"), phone);
    const { page } = view;
    const { origin } = new URL(inject("pageUrl"));
    const heard = await watchViolations(page.context(), origin);
    await serve(page, `${origin}${probe}-report?token=secret`, {
      "Content-Security-Policy-Report-Only":
        "img-src 'none'; script-src 'none'",
    });
    await serve(page, `${origin}${probe}-enforce`, {
      "Content-Security-Policy": "img-src 'none'",
    });
    await page.goto(`${origin}${probe}-report?token=secret`);
    await page.goto(`${origin}${probe}-enforce`);
    await expect.poll(() => heard().length).toBe(3);
    expect(byPlace(heard())).toEqual([
      {
        page: `${origin}${probe}-enforce`,
        directive: "img-src",
        blocked: `${origin}/csp-probe.png`,
        disposition: "enforce",
      },
      {
        page: `${origin}${probe}-report`,
        directive: "img-src",
        blocked: `${origin}/csp-probe.png`,
        disposition: "report",
      },
      {
        page: `${origin}${probe}-report`,
        directive: "script-src-elem",
        blocked: "inline",
        disposition: "report",
      },
    ]);
    expect(JSON.stringify(heard())).not.toContain("secret");
  });

  it("leaves out a page on another address, as Clerk's own screens are", async () => {
    view = await openPage(inject("pageUrl"), phone);
    const { page } = view;
    const watched = new URL(inject("pageUrl"));
    const elsewhere = new URL(watched);
    elsewhere.hostname = "localhost";
    const heard = await watchViolations(page.context(), watched.origin);
    for (const { origin } of [elsewhere, watched]) {
      await serve(page, `${origin}${probe}`, {
        "Content-Security-Policy": "img-src 'none'",
      });
    }
    await page.goto(`${elsewhere.origin}${probe}`);
    await page.goto(`${watched.origin}${probe}`);
    await expect.poll(() => heard().length).toBe(1);
    expect(heard().map(({ page: where }) => where)).toEqual([
      `${watched.origin}${probe}`,
    ]);
  });
});
