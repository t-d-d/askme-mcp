import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import {
  counts,
  scratch,
  strykerOptions,
  survivorsTsv,
  targetFile,
  testCommand,
  verdict,
  type Mutant,
} from "./mutation";

const mutant = (
  fileName: string,
  status: string,
  line = 1,
  replacement = "false",
): Mutant => ({
  fileName,
  status,
  mutatorName: "ConditionalExpression",
  replacement,
  location: { start: { line, column: 3 } },
});

describe("the command a mutant's tests run with", () => {
  it("runs the test files in the tier each one belongs to, and no other tier", () => {
    expect(testCommand(["service/src/rate.test.ts"])).toBe(
      "npx vitest run --project unit service/src/rate.test.ts",
    );
    expect(
      testCommand(["service/api.int.ts", "service/src/sorter.test.ts"]),
    ).toBe(
      "npx vitest run --project unit --project int service/api.int.ts service/src/sorter.test.ts",
    );
  });

  it("refuses a test file outside the unit and integration tiers", () => {
    expect(() => testCommand(["web/cards.browser.ts"])).toThrow(
      "web/cards.browser.ts",
    );
    expect(() => testCommand(["test/filenames.static.ts"])).toThrow(
      "test/filenames.static.ts",
    );
    expect(() => testCommand(["service/src/rate.ts"])).toThrow(
      "service/src/rate.ts",
    );
  });

  it("refuses a path the shell would split or read as code", () => {
    expect(() => testCommand(["service/src/my rate.test.ts"])).toThrow(
      "service/src/my rate.test.ts",
    );
    expect(() => testCommand(["service/src/$(rm).test.ts"])).toThrow(
      "service/src/$(rm).test.ts",
    );
  });

  it("refuses a suite with no test files", () => {
    expect(() => testCommand([])).toThrow();
  });
});

describe("Stryker's options for a suite", () => {
  const suite = {
    about: "Rate windows.",
    mutate: ["service/src/rate.ts", "service/src/api.ts:74-130"],
    tests: ["service/src/rate.test.ts"],
  };
  const options = strykerOptions(suite, "/tmp/askme-mutation/rate/sandboxes");

  it("runs the suite's tests through the command runner, once for each mutant", () => {
    expect(options.testRunner).toBe("command");
    expect(options.commandRunner).toEqual({
      command: "npx vitest run --project unit service/src/rate.test.ts",
    });
    expect(options.coverageAnalysis).toBe("off");
  });

  it("mutates the suite's files and line ranges", () => {
    expect(options.mutate).toEqual([
      "service/src/rate.ts",
      "service/src/api.ts:74-130",
    ]);
  });

  it("keeps its sandboxes in the folder it is given, and removes them", () => {
    expect(options.tempDirName).toBe("/tmp/askme-mutation/rate/sandboxes");
    expect(options.cleanTempDir).toBe(true);
  });

  it("reports to the terminal only, so no report is written into the repo", () => {
    expect(options.reporters).toEqual(["clear-text"]);
  });

  // A crowded machine slows each run past Stryker's time limit, and Stryker
  // counts a mutant that timed out as killed, which would hide a survivor.
  it("runs at most three mutants at once, and leaves a core free", () => {
    const at = (cores: number) =>
      strykerOptions(suite, "/tmp/sandboxes", cores).concurrency;
    expect(at(16)).toBe(3);
    expect(at(4)).toBe(3);
    expect(at(3)).toBe(2);
    expect(at(2)).toBe(1);
    expect(at(1)).toBe(1);
  });
});

describe("the count for each file", () => {
  it("counts a mutant that timed out as killed, and one no test reached as survived", () => {
    expect(
      counts(
        [
          mutant("/repo/service/src/rate.ts", "Killed"),
          mutant("/repo/service/src/rate.ts", "Timeout"),
          mutant("/repo/service/src/rate.ts", "Survived"),
          mutant("/repo/service/src/api.ts", "NoCoverage"),
          mutant("/repo/service/src/api.ts", "Killed"),
        ],
        "/repo",
      ),
    ).toEqual([
      { file: "service/src/api.ts", killed: 1, survived: 1 },
      { file: "service/src/rate.ts", killed: 2, survived: 1 },
    ]);
  });

  it("leaves out a mutant that did not compile or broke the run", () => {
    expect(
      counts(
        [
          mutant("/repo/service/src/rate.ts", "CompileError"),
          mutant("/repo/service/src/rate.ts", "RuntimeError"),
          mutant("/repo/service/src/rate.ts", "Killed"),
        ],
        "/repo",
      ),
    ).toEqual([{ file: "service/src/rate.ts", killed: 1, survived: 0 }]);
  });

  it("takes a path Stryker gives relative to the repo as it is", () => {
    expect(counts([mutant("service/src/rate.ts", "Killed")], "/repo")).toEqual([
      { file: "service/src/rate.ts", killed: 1, survived: 0 },
    ]);
  });
});

describe("the verdict on a run", () => {
  it("fails a run that killed no mutant, since its tests did not run against them", () => {
    expect(
      verdict([
        mutant("/repo/service/src/rate.ts", "Survived"),
        mutant("/repo/service/src/rate.ts", "NoCoverage"),
      ]),
    ).toMatch(/no mutant was killed.*ran no tests/iu);
  });

  it("fails a run that made no mutant", () => {
    expect(verdict([])).toMatch(/no mutant/iu);
  });

  it("passes a run that killed one mutant, whatever survived", () => {
    expect(
      verdict([
        mutant("/repo/service/src/rate.ts", "Survived"),
        mutant("/repo/service/src/rate.ts", "Timeout"),
      ]),
    ).toBeUndefined();
  });
});

describe("the file a suite's target names", () => {
  it("is the path without its range of lines, or of lines and columns", () => {
    expect(targetFile("service/src/rate.ts")).toBe("service/src/rate.ts");
    expect(targetFile("service/src/api.ts:74-130")).toBe("service/src/api.ts");
    expect(targetFile("service/src/api.ts:74:3-130:5")).toBe(
      "service/src/api.ts",
    );
  });
});

describe("the folder a run keeps its files in", () => {
  it("is in the system's temp folder, and apart for each checkout", () => {
    const one = scratch("/home/a/askme-mcp", "askme-mutation");
    const other = scratch("/home/b/askme-mcp", "askme-mutation");
    expect(one.startsWith(tmpdir())).toBe(true);
    expect(one).not.toBe(other);
    expect(scratch("/home/a/askme-mcp", "askme-mutation")).toBe(one);
  });
});

describe("the list of survivors", () => {
  it("orders two survivors at one place by mutator and replacement, whatever order the run finished them in", () => {
    const first = {
      ...mutant("/repo/service/src/rate.ts", "Survived", 3, "true"),
      mutatorName: "BooleanLiteral",
    };
    const second = mutant("/repo/service/src/rate.ts", "Survived", 3, "false");
    const third = mutant("/repo/service/src/rate.ts", "Survived", 3, "true");
    expect(survivorsTsv([third, second, first], "/repo")).toBe(
      survivorsTsv([first, second, third], "/repo"),
    );
    expect(survivorsTsv([third, second, first], "/repo").split("\n")).toEqual([
      "file\tline\tcolumn\tmutator\treplacement",
      "service/src/rate.ts\t3\t3\tBooleanLiteral\ttrue",
      "service/src/rate.ts\t3\t3\tConditionalExpression\tfalse",
      "service/src/rate.ts\t3\t3\tConditionalExpression\ttrue",
      "",
    ]);
  });

  it("has one line for each mutant no test caught, by file and place, with tabs and line ends in the replacement written out", () => {
    expect(
      survivorsTsv(
        [
          mutant("/repo/service/src/rate.ts", "Survived", 9, "a\tb"),
          mutant("/repo/service/src/rate.ts", "Killed", 2),
          mutant("/repo/service/src/api.ts", "NoCoverage", 4, "{\n}"),
          mutant("/repo/service/src/rate.ts", "Survived", 3),
        ],
        "/repo",
      ),
    ).toBe(
      [
        "file\tline\tcolumn\tmutator\treplacement",
        "service/src/api.ts\t4\t3\tConditionalExpression\t{\\n}",
        "service/src/rate.ts\t3\t3\tConditionalExpression\tfalse",
        "service/src/rate.ts\t9\t3\tConditionalExpression\ta\\tb",
        "",
      ].join("\n"),
    );
  });
});
