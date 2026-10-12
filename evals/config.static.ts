// How `npm run eval` reports. Running the eval is not in the gate
// (test-tiers.md), but its config and its script are files in the repo.
import { execFile } from "node:child_process";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { root, scripts } from "../test/repo";
import config from "./vitest.config";

const run = promisify(execFile);

describe("the eval's config", () => {
  it("shows the scores to an agent as to a person", () => {
    expect(config).toMatchObject({ test: { silent: false } });
  });

  // The setting above shows the scores only because of how one version of
  // Vitest reads it, so this runs the eval script as an agent would and
  // reads what it prints. It runs the script as npm does, in a shell with
  // the repo's own commands on the path, and with nothing else in the
  // environment but the variable Claude Code sets, which Vitest takes as the
  // sign of an agent. --dir points Vitest at the fixture's folder, which
  // holds one test that prints a line and passes, in place of the eval set.
  // --no-cache keeps the run from writing anything.
  it("prints a passing test's output when an agent runs the eval script", async () => {
    const script = scripts().eval;
    if (script === undefined) {
      throw new Error("package.json has no eval script.");
    }
    const { stdout } = await run(
      "sh",
      ["-c", `${script} --dir test/eval-fixture --no-cache`],
      {
        cwd: root,
        env: {
          PATH: [
            join(root, "node_modules", ".bin"),
            process.env.PATH ?? "",
          ].join(delimiter),
          CLAUDECODE: "1",
        },
      },
    );
    expect(stdout).toContain("A passing test printed this line.");
  }, 60_000);
});
