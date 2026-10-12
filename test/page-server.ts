// Global setup for the browser tier: build the page into a temporary folder
// and serve it on loopback. Tests read the address with inject("pageUrl").
//
// The gate cannot reach Clerk (ADR 9), so the page is built with the
// stand-in in test/page/fake-clerk.tsx in place of web/src/clerk.tsx.
//
// The page is built with React's development code, so StrictMode runs in
// every browser test. Some tests see a bug only because it runs. Vite
// picks React's code by the NODE_ENV the run starts with, and Vitest sets
// that to "test" only when it is unset, so a run started with
// NODE_ENV=production would get React's production code without the define
// below.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview } from "vite";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    pageUrl: string;
    pageDir: string;
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
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    resolve: { alias: [{ find: /^\.\/clerk$/u, replacement: fakeClerk }] },
  });
  const server = await preview({
    root: web,
    logLevel: "warn",
    build: { outDir },
    preview: { host: "127.0.0.1", port: 0 },
  });
  const url = server.resolvedUrls?.local[0];
  if (url === undefined) throw new Error("The page server has no address.");
  project.provide("pageUrl", url);
  project.provide("pageDir", outDir);
  return async () => {
    await server.close();
    await rm(outDir, { recursive: true, force: true });
  };
}
