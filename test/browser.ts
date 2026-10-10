// Opens a page in headless Chromium for the browser tier. Any request that is
// not to loopback is refused and recorded, so a test can see that it happened.
import { chromium, type Page } from "playwright";
import { isLoopbackHost } from "./loopback";

export interface OpenPage {
  page: Page;
  refused: string[];
  close(): Promise<void>;
}

export async function openPage(
  url: string,
  viewport: { width: number; height: number },
): Promise<OpenPage> {
  const browser = await chromium.launch();
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
  const page = await context.newPage();
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  return { page, refused, close: () => browser.close() };
}
