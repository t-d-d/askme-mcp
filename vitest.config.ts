import { configDefaults, defineConfig } from "vitest/config";
import { tierPattern, tiers } from "./test/tiers.ts";

// One project per tier. `npm run test` runs the gate's tiers,
// `npm run test:live` runs the live tier after a deploy, and
// `npm run conformance` runs the conformance tier every day.
export default defineConfig({
  test: {
    projects: tiers.map((tier) => ({
      test: {
        name: tier.name,
        include: [tierPattern(tier)],
        exclude: [...configDefaults.exclude, "**/dist/**"],
        setupFiles: tier.inGate ? ["test/offline.ts"] : [],
        globalSetup: tier.name === "browser" ? ["test/page-server.ts"] : [],
        testTimeout:
          tier.name === "static" || tier.name === "unit" || tier.name === "int"
            ? 5_000
            : 30_000,
      },
    })),
  },
});
