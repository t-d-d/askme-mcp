// How `npm run eval` reports. Running the eval is not in the gate
// (test-tiers.md), but its config is a file in the repo.
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { root } from "../test/repo";
import config from "./vitest.config";

const run = promisify(execFile);

describe("the eval's config", () => {
  it("shows the scores to an agent as to a person", () => {
    expect(config).toMatchObject({ test: { silent: false } });
  });

  // The setting above shows the scores only because of how one version of
  // Vitest reads it, so this runs Vitest with the eval config as an agent
  // would, and reads what it prints. --dir points it at the fixture's
  // folder, which holds one test that prints a line and passes, in place of
  // the eval set. --no-cache keeps it from writing Vitest's results cache.
  // Like the gate's own run, it still writes a bundled copy of the config to
  // node_modules/.vite-temp, and removes it once the config has loaded.
  //
  // The run is a process of its own, which the gate's offline guard does not
  // reach. It holds no key and no proxy, as its environment is only the
  // variable Claude Code sets, which Vitest takes as the sign of an agent.
  // It stays offline while the eval config runs nothing of its own before the
  // fixture.
  it("prints a passing test's output when an agent runs it", async () => {
    expect(config.test?.globalSetup).toBeUndefined();
    expect(config.test?.setupFiles).toBeUndefined();
    const { stdout } = await run(
      process.execPath,
      [
        join(root, "node_modules", ".bin", "vitest"),
        "run",
        "--config",
        "evals/vitest.config.ts",
        "--dir",
        "test/eval-fixture",
        "--no-cache",
      ],
      { cwd: root, env: { CLAUDECODE: "1" } },
    );
    expect(stdout).toContain("A passing test printed this line.");
  }, 60_000);
});
