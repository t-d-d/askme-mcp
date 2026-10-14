// Global setup for the browser tier: builds the page and serves it on
// loopback.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview } from "vite";
import type { TestProject } from "vitest/node";
import { clerkHost, pageCsp } from "./page-csp";

declare module "vitest" {
  export interface ProvidedContext {
    pageUrl: string;
    pageDir: string;
    // The header it is sent in, in lower case, and its value.
    pageCsp: { header: string; value: string };
  }
}

const web = fileURLToPath(new URL("../web", import.meta.url));
const fakeClerk = fileURLToPath(
  new URL("./page/fake-clerk.tsx", import.meta.url),
);

export default async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  const outDir = await mkdtemp(join(tmpdir(), "askme-page-"));
  await build({
    root: web,
    logLevel: "warn",
    build: { outDir, emptyOutDir: true },
    // StrictMode runs only in React's development code. Vitest sets NODE_ENV
    // only when it is unset, so a run started with NODE_ENV=production would
    // build React's production code without this.
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    resolve: { alias: [{ find: /^\.\/clerk$/u, replacement: fakeClerk }] },
  });
  // The page's CSP as the deploy sends it (ADR 28). The fake Clerk loads
  // nothing, so Clerk's host is one that resolves nowhere.
  const csp = pageCsp();
  const served = {
    header: csp.header,
    value: csp.value.replaceAll(clerkHost, "https://clerk.invalid"),
  };
  const server = await preview({
    root: web,
    logLevel: "warn",
    build: { outDir },
    preview: {
      host: "127.0.0.1",
      port: 0,
      headers: { [served.header]: served.value },
    },
  });
  const url = server.resolvedUrls?.local[0];
  if (url === undefined) throw new Error("The page server has no address.");
  project.provide("pageUrl", url);
  project.provide("pageDir", outDir);
  project.provide("pageCsp", served);
  return async () => {
    await server.close();
    await rm(outDir, { recursive: true, force: true });
  };
}
