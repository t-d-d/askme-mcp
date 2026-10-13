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

  // `silent: false` works only because of how this Vitest version reads it,
  // so this runs Vitest as an agent would. Vitest takes CLAUDECODE as the
  // sign of an agent. The gate's offline guard does not reach the child
  // process, so it gets no key or proxy, and the config must run nothing of
  // its own before the fixture.
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
