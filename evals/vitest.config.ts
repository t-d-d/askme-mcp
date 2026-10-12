import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The eval runs on its own, with `npm run eval`, never in the gate: it calls
// the real model, which costs money and is not deterministic (ADR 9).
export default defineConfig({
  test: {
    root: fileURLToPath(new URL("..", import.meta.url)),
    include: ["evals/*.eval.ts"],
    testTimeout: 30 * 60_000,
    // The scores are printed from a passing test. Without this, Vitest hides
    // them when an agent runs it.
    silent: false,
  },
});
