// Mutation testing (#215): Stryker rewrites one operator, literal or branch
// of the code at a time, runs the tests against each rewrite, and reports
// the rewrites, or mutants, that no test failed on. A survivor is a change
// to the code no test can see. Coverage says a line ran, and this says
// whether a test noticed what it did.
//
// Stryker runs each mutant through its command runner, which starts vitest
// with the mutant switched on by an environment variable. Its vitest runner
// reports every mutant as survived here: with the tiers as vitest projects,
// and with vitest 5, it runs no test per mutant. So a run that kills no
// mutant fails, as a broken harness looks exactly like that.
//
// Node runs test/mutate.ts with its types stripped, so this module imports
// with the file's extension, and imports nothing it would have to build.
import { createHash } from "node:crypto";
import { availableParallelism, tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { tiers } from "./tiers.ts";

// A folder in the system's temp folder for one kind of run, apart for each
// checkout, so runs in two worktrees at once do not clear each other's files.
export function scratch(root: string, kind: string): string {
  const checkout = createHash("sha256").update(root).digest("hex").slice(0, 12);
  return join(tmpdir(), kind, checkout);
}

// The file a suite's target names, without its range of lines, written
// "path:74-130", or of lines and columns, written "path:74:3-130:5".
export function targetFile(target: string): string {
  return target.replace(/:\d+(?::\d+)?-\d+(?::\d+)?$/u, "");
}

// The command runner hands its command to a shell, so a path is kept to
// letters, digits and the marks a path needs, which the shell reads as text.
const plainPath = /^[\w./-]+$/u;

// A named set of code to mutate and the tests that guard it.
export interface Suite {
  // What the code does, in a line, for the list of suites.
  about: string;
  // The files to mutate, each a path, or a path with a range of lines, as
  // "service/src/api.ts:132-190".
  mutate: readonly string[];
  // The test files run against each mutant. Each mutant costs one run of
  // them all, so name only the files that exercise the code.
  tests: readonly string[];
}

// A mutant as Stryker reports it, in the parts read here.
export interface Mutant {
  fileName: string;
  status: string;
  mutatorName: string;
  replacement?: string | undefined;
  location: { start: { line: number; column: number } };
}

// The tiers a suite's tests may come from. A static test reads the repo's
// own files, which a sandbox is not, and a browser test reads the built
// page, which a mutant does not rebuild.
const runnable = new Set(["unit", "int"]);

// The name of the tier a test file's suffix puts it in.
const tierOf = (path: string) =>
  tiers.find((tier) => path.endsWith(tier.suffix))?.name;

// The vitest command that runs a suite's tests, in the tiers they belong to.
export function testCommand(tests: readonly string[]): string {
  if (tests.length === 0) throw new Error("A suite needs a test file.");
  const used = new Set<string>();
  for (const path of tests) {
    if (!plainPath.test(path)) {
      throw new Error(
        `${path} has a character the shell would read, so a suite cannot run it.`,
      );
    }
    const tier = tierOf(path);
    if (tier === undefined || !runnable.has(tier)) {
      throw new Error(
        `${path} is not a unit or integration test, so a suite cannot run it.`,
      );
    }
    used.add(tier);
  }
  const projects = tiers
    .filter((tier) => used.has(tier.name))
    .map((tier) => `--project ${tier.name}`);
  return ["npx vitest run", ...projects, ...tests].join(" ");
}

// The most mutants run at once. Each run is a whole vitest run, and a
// crowded machine slows a run past Stryker's time limit, and Stryker counts
// a mutant that timed out as killed, which would hide a survivor.
const mostAtOnce = 3;

// How many mutants run at once. A suite with an integration test runs one
// at a time, as Stryker's first run without a mutant did. Each integration
// run starts its own DynamoDB, and with three at once on four cores a test
// that polls sixty times passed vitest's time limit with no mutant at all.
// The command failed, and Stryker counted the mutant killed (#286).
function atOnce(suite: Suite, cores: number): number {
  if (suite.tests.some((path) => tierOf(path) === "int")) return 1;
  return Math.max(1, Math.min(mostAtOnce, cores - 1));
}

// Stryker's options for a suite, with its sandboxes in the given folder.
// The only reporter writes to the terminal, so nothing lands in the repo.
export function strykerOptions(
  suite: Suite,
  sandboxes: string,
  cores = availableParallelism(),
) {
  return {
    testRunner: "command",
    commandRunner: { command: testCommand(suite.tests) },
    mutate: [...suite.mutate],
    coverageAnalysis: "off" as const,
    concurrency: atOnce(suite, cores),
    reporters: ["clear-text"],
    tempDirName: sandboxes,
    cleanTempDir: true,
  };
}

// A mutant a test failed on, or that ran past its time. Stryker counts a
// timeout as found, since a mutant that loops for ever is caught too.
const killed = (mutant: Mutant) =>
  mutant.status === "Killed" || mutant.status === "Timeout";

// A mutant every test passed with, or that no test reached.
const survived = (mutant: Mutant) =>
  mutant.status === "Survived" || mutant.status === "NoCoverage";

const inRepo = (file: string, root: string) =>
  isAbsolute(file) ? relative(root, file) : file;

// The mutants killed and survived in each file, by path in the repo. A
// mutant that did not compile, or broke the run, is neither.
export function counts(
  mutants: readonly Mutant[],
  root: string,
): { file: string; killed: number; survived: number }[] {
  const byFile = new Map<string, { killed: number; survived: number }>();
  for (const mutant of mutants) {
    const file = inRepo(mutant.fileName, root);
    const count = byFile.get(file) ?? { killed: 0, survived: 0 };
    if (killed(mutant)) count.killed += 1;
    if (survived(mutant)) count.survived += 1;
    byFile.set(file, count);
  }
  return [...byFile]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, count]) => ({ file, ...count }));
}

// Why a run proves nothing, or undefined when it can be read.
export function verdict(mutants: readonly Mutant[]): string | undefined {
  if (mutants.length === 0) {
    return "The suite made no mutant. Check its paths and line ranges.";
  }
  if (!mutants.some(killed)) {
    return "No mutant was killed, so the harness ran no tests, or ran them without the mutant switched on. Its survivors say nothing about the tests.";
  }
  const ran = mutants.filter((mutant) => killed(mutant) || survived(mutant));
  const timedOut = ran.filter((mutant) => mutant.status === "Timeout");
  if (timedOut.length * 2 > ran.length) {
    return `Most of the mutants timed out, ${String(timedOut.length)} of the ${String(ran.length)} that ran, so the machine was likely too slow for Stryker's time limit. A timeout counts as killed, so the run's survivors say nothing about the tests.`;
  }
  return undefined;
}

// Writes tabs and line ends out, so one mutant stays on one line.
const oneLine = (text: string) =>
  text.replaceAll("\t", "\\t").replaceAll("\r", "\\r").replaceAll("\n", "\\n");

// Every survivor as one line of tab-separated values, by file, place,
// mutator and replacement, so two runs can be compared with diff. Stryker
// gives its results in the order its runs finished, which differs each run.
export function survivorsTsv(mutants: readonly Mutant[], root: string): string {
  const rows = mutants
    .filter(survived)
    .map((mutant) => ({
      file: inRepo(mutant.fileName, root),
      ...mutant.location.start,
      mutator: mutant.mutatorName,
      replacement: oneLine(mutant.replacement ?? ""),
    }))
    .sort(
      (a, b) =>
        a.file.localeCompare(b.file) ||
        a.line - b.line ||
        a.column - b.column ||
        a.mutator.localeCompare(b.mutator) ||
        a.replacement.localeCompare(b.replacement),
    )
    .map((row) =>
      [row.file, row.line, row.column, row.mutator, row.replacement].join("\t"),
    );
  return [
    ["file", "line", "column", "mutator", "replacement"].join("\t"),
    ...rows,
    "",
  ].join("\n");
}
