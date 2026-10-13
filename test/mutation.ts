// Node runs test/mutate.ts with its types stripped, so this module imports
// with the file's extension, and imports nothing it would have to build.
import { createHash } from "node:crypto";
import { availableParallelism, tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { tiers } from "./tiers.ts";

// Apart for each checkout, so runs in two worktrees at once do not clear
// each other's files.
export function scratch(root: string, kind: string): string {
  const checkout = createHash("sha256").update(root).digest("hex").slice(0, 12);
  return join(tmpdir(), kind, checkout);
}

// The command runner hands its command to a shell, so a path is kept to
// letters, digits and the marks a path needs, which the shell reads as text.
const plainPath = /^[\w./-]+$/u;

export interface Suite {
  // One line, for the list of suites.
  about: string;
  mutate: readonly string[];
  // Each mutant costs one run of them all, so name only the files that
  // exercise the code.
  tests: readonly string[];
}

// The parts of Stryker's mutant read here.
export interface Mutant {
  fileName: string;
  status: string;
  mutatorName: string;
  replacement?: string | undefined;
  location: { start: { line: number; column: number } };
}

// A static test reads the repo's own files, which a sandbox is not, and a
// browser test reads the built page, which a mutant does not rebuild.
const runnable = new Set(["unit", "int"]);

const tierOf = (path: string) =>
  tiers.find((tier) => path.endsWith(tier.suffix))?.name;

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

// Each mutant is a whole vitest run. A crowded machine slows a run past
// Stryker's time limit, and Stryker counts a mutant that timed out as
// killed, which would hide a survivor.
const mostAtOnce = 3;

// Each integration run starts its own DynamoDB, and several at once can
// push a test past vitest's time limit, which Stryker counts as a kill.
function atOnce(suite: Suite, cores: number): number {
  if (suite.tests.some((path) => tierOf(path) === "int")) return 1;
  return Math.max(1, Math.min(mostAtOnce, cores - 1));
}

// The only reporter writes to the terminal, so nothing lands in the repo.
export function strykerOptions(
  suite: Suite,
  sandboxes: string,
  cores = availableParallelism(),
) {
  return {
    // Stryker's vitest runner, with the tiers as vitest projects, runs no
    // test per mutant, so every mutant would survive.
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

// Stryker counts a timeout as killed, since a mutant that loops for ever is
// caught too.
const killed = (mutant: Mutant) =>
  mutant.status === "Killed" || mutant.status === "Timeout";

const survived = (mutant: Mutant) =>
  mutant.status === "Survived" || mutant.status === "NoCoverage";

const inRepo = (file: string, root: string) =>
  isAbsolute(file) ? relative(root, file) : file;

// A mutant that did not compile, or broke the run, is neither.
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
    return "The suite made no mutant. Check its paths.";
  }
  if (!mutants.some(killed)) {
    return "No mutant was killed, so the harness ran no tests, or ran them without the mutant switched on. Its survivors say nothing about the tests.";
  }
  // A mutant no test reached did not run.
  const ran = mutants.filter(
    (mutant) => killed(mutant) || mutant.status === "Survived",
  );
  const timedOut = ran.filter((mutant) => mutant.status === "Timeout");
  if (timedOut.length * 2 > ran.length) {
    return `Most of the mutants timed out, ${String(timedOut.length)} of the ${String(ran.length)} that ran, so the machine was likely too slow for Stryker's time limit. A timeout counts as killed, so the run's survivors say nothing about the tests.`;
  }
  return undefined;
}

const oneLine = (text: string) =>
  text.replaceAll("\t", "\\t").replaceAll("\r", "\\r").replaceAll("\n", "\\n");

// Sorted, so two runs can be compared with diff: Stryker gives its results
// in the order its runs finished, which differs each run.
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
