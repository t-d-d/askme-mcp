import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import { scratch } from "./test/mutation.ts";
import { tierPattern, tiers } from "./test/tiers.ts";

const globalSetup: Record<string, string[]> = {
  browser: ["test/page-server.ts"],
  int: ["test/dynamodb.ts"],
};

const setupFiles: Record<string, string[]> = {
  int: ["test/database-env.ts", "test/service-env.ts"],
};

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
      // Vitest leaves out only *.test.ts by itself.
      exclude: [
        ...tiers.map(tierPattern),
        "**/*.eval.ts",
        "**/vitest.config.ts",
      ],
      reporter: ["text"],
      reportsDirectory: scratch(
        fileURLToPath(new URL(".", import.meta.url)),
        "askme-coverage",
      ),
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
