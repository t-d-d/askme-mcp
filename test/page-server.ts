// Global setup for the browser tier: build the page into a temporary folder
// and serve it on loopback. Tests read the address with inject("pageUrl").
//
// The gate cannot reach Clerk (ADR 9), so the page is built with the
// stand-in in test/page/fake-clerk.tsx in place of web/src/clerk.tsx.
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
