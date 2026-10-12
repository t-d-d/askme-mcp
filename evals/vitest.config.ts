import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The eval runs on its own, with `npm run eval`, never in the gate: it calls
// the real model, which costs money and is not deterministic (ADR 9).
export default defineConfig({
  test: {
    root: fileURLToPath(new URL("..", import.meta.url)),
    include: ["evals/*.eval.ts"],
    testTimeout: 30 * 60_000,
  },
});
