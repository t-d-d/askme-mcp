import { describe, expect, inject, it } from "vitest";
import { openPage } from "./browser";

describe("openPage", () => {
  it("closes without a late error from a route that is still running", async () => {
    const open = await openPage(inject("pageUrl"), { width: 390, height: 844 });
    const late: unknown[] = [];
    const record = (reason: unknown) => late.push(reason);
    process.on("unhandledRejection", record);
    try {
      let ran: () => void = () => undefined;
      const finished = new Promise<void>((resolve) => {
        ran = resolve;
      });
      await open.page.context().route("https://example.com/", async (route) => {
        try {
          await open.close();
          // Fails, as an abort still on its way when the browser closed does.
          await route.request().headerValue("authorization");
        } finally {
          ran();
        }
      });
      // The route closes the browser, which may happen before the page
      // answers this call.
      const opened = open.page
        .evaluate(() => {
          window.open("https://example.com/", "_blank");
        })
        .catch(() => null);
      await Promise.all([finished, opened]);
      // A late error lands once the route has finished, so give it a moment.
      await new Promise((settled) => setTimeout(settled, 100));
    } finally {
      process.off("unhandledRejection", record);
      await open.close();
    }
    expect(late).toEqual([]);
  });

  it("gives the page a stopped clock, which moves only when a test moves it on", async () => {
    const open = await openPage(
      inject("pageUrl"),
      { width: 390, height: 844 },
      { clock: "stopped" },
    );
    try {
      const now = () => open.page.evaluate(() => Date.now());
      const start = await now();
      await new Promise((waited) => setTimeout(waited, 100));
      expect(await now()).toBe(start);
      await open.page.clock.runFor(1);
      expect(await now()).toBe(start + 1);
    } finally {
      await open.close();
    }
  });
});
