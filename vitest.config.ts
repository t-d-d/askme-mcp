import { tmpdir } from "node:os";
import { join } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";
import { tierPattern, tiers } from "./test/tiers.ts";

// What each tier starts before its tests: the browser tier serves the built
// page, and the integration tier runs a local DynamoDB (ADR 9), and for
// each test file the stand-ins for the model, Parameter Store and the sort
// queue.
const globalSetup: Record<string, string[]> = {
  browser: ["test/page-server.ts"],
  int: ["test/dynamodb.ts"],
};

const setupFiles: Record<string, string[]> = {
  int: ["test/database-env.ts", "test/service-env.ts"],
};

// One project per tier. `npm run test` runs the gate's tiers,
// `npm run test:live` runs the live tier after a deploy, and
// `npm run conformance` runs the conformance tier every day.
//
// `npm run coverage` runs the unit and integration tiers with coverage, by
// hand and outside the gate (#215). It prints each file's line and branch
// coverage, and keeps its report out of the repo. The browser tier's code
// runs in Chromium, which v8 coverage here does not see.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: [
        "service/src/**/*.ts",
        "shared/**/*.ts",
        "web/src/**/*.{ts,tsx}",
        "evals/**/*.ts",
      ],
      reporter: ["text"],
      reportsDirectory: join(tmpdir(), "askme-coverage"),
    },
    projects: tiers.map((tier) => ({
      test: {
        name: tier.name,
        include: [tierPattern(tier)],
        exclude: [...configDefaults.exclude, "**/dist/**"],
        setupFiles: [
          ...(tier.inGate ? ["test/offline.ts"] : []),
          ...(setupFiles[tier.name] ?? []),
        ],
        globalSetup: globalSetup[tier.name] ?? [],
        testTimeout:
          tier.name === "static" || tier.name === "unit" || tier.name === "int"
            ? 5_000
            : 30_000,
      },
    })),
  },
});
