// The commands that measure how well the tests guard the code: coverage of
// the unit and integration tiers, and mutation testing by named suite. Both
// run by hand, outside the gate (test-tiers.md).
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { targetFile, testCommand } from "./mutation";
import { suites } from "./mutation-suites";
import { root, scripts } from "./repo";
import { tierPattern, tiers } from "./tiers";

const isTest = (path: string) =>
  tiers.some((tier) => path.endsWith(tier.suffix));

describe("fitness: measuring the tests stays out of the gate (test-tiers.md)", () => {
  it("measures coverage of the unit and integration tiers", () => {
    expect(scripts().coverage).toBe(
      "vitest run --project unit --project int --coverage",
    );
  });

  it("runs mutation testing from its own script", () => {
    expect(scripts().mutate).toBe("node test/mutate.ts");
  });

  it("leaves both out of the gate", () => {
    for (const name of ["gate", "test"]) {
      expect(scripts()[name]).not.toMatch(/coverage|mutate/u);
    }
  });

  const coverage = async () =>
    z
      .object({
        test: z.object({
          coverage: z.object({
            reportsDirectory: z.string(),
            exclude: z.array(z.string()),
          }),
        }),
      })
      .parse((await import("../vitest.config")).default).test.coverage;

  it("writes the coverage report outside the repo", async () => {
    expect((await coverage()).reportsDirectory.startsWith(tmpdir())).toBe(true);
  });

  it("leaves every tier's test files, the evals and their config out of the coverage report", async () => {
    const { exclude } = await coverage();
    for (const tier of tiers) expect(exclude).toContain(tierPattern(tier));
    expect(exclude).toContain("**/*.eval.ts");
    expect(exclude).toContain("**/vitest.config.ts");
  });
});

describe("the mutation suites", () => {
  const all = Object.entries(suites);

  it("are there", () => {
    expect(all.length).toBeGreaterThan(0);
  });

  it.each(all)("%s mutates source files that exist", (_, suite) => {
    expect(suite.mutate.length).toBeGreaterThan(0);
    for (const target of suite.mutate) {
      const path = targetFile(target);
      expect(existsSync(join(root, path)), target).toBe(true);
      expect(isTest(path), target).toBe(false);
    }
  });

  it.each(all)(
    "%s runs test files that exist, from the unit and integration tiers",
    (_, suite) => {
      for (const path of suite.tests) {
        expect(existsSync(join(root, path)), path).toBe(true);
      }
      expect(() => testCommand(suite.tests)).not.toThrow();
    },
  );
});
