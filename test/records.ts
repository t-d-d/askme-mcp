// The decision records' fitness tables, and the fitness tests that answer
// them.
import { readRepoFile, repoFiles } from "./repo";
import { tiers } from "./tiers";

const recordPath = /^docs\/adr\/(\d{4})-[a-z0-9-]+\.md$/u;
const constraintPath = /^docs\/constraints\/([a-z0-9-]+)\.md$/u;

// Any Markdown file in docs/adr/ but the index is a record, so one named
// against the pattern throws instead of being left out.
export function records(): { record: number; path: string }[] {
  return repoFiles()
    .filter(
      (path) =>
        path.startsWith("docs/adr/") &&
        path.endsWith(".md") &&
        path !== "docs/adr/README.md",
    )
    .map((path) => {
      const number = recordPath.exec(path)?.[1];
      if (number === undefined) {
        throw new Error(`${path} is not named as a record is, NNNN-name.md.`);
      }
      return { record: Number(number), path };
    })
    .sort((a, b) => a.record - b.record);
}

// A section or row laid out any other way throws, so no check is lost
// without a failure.
export function checksIn(text: string): string[] {
  const start = text.indexOf("\n## Fitness functions\n");
  if (start === -1) throw new Error("It has no Fitness functions section.");
  const rest = text.slice(start + 1);
  const end = rest.indexOf("\n## ");
  const lines = (end === -1 ? rest : rest.slice(0, end))
    .split("\n")
    .filter((line) => line.includes("|"));
  const [header, divider, ...rows] = lines;
  if (
    header?.startsWith("| Check |") !== true ||
    divider?.startsWith("| --- |") !== true
  ) {
    throw new Error(
      "Its table does not open with a Check header and a divider.",
    );
  }
  return rows.map((row) => {
    const name = row.startsWith("|") ? row.split("|")[1]?.trim() : undefined;
    if (name === undefined || name === "") {
      throw new Error(`This row names no check: ${row}`);
    }
    return name;
  });
}

// Each constraint's name, without .md, and the records its History line
// names.
export function constraintHistory(): Map<string, number[]> {
  const history = new Map<string, number[]>();
  for (const path of repoFiles()) {
    const name = constraintPath.exec(path)?.[1];
    if (name === undefined) continue;
    const line =
      readRepoFile(path)
        .split("\n")
        .find((text) => text.startsWith("History:")) ?? "";
    history.set(
      name,
      [...line.matchAll(/adr\/(\d{4})-/gu)].map((match) => Number(match[1])),
    );
  }
  return history;
}

// Named as CLAUDE.md says. Only a describe's first argument counts, either
// `describe(` or the second call of `describe.each(...)(`, so a string that
// only quotes one, as a static test may, does not. A describe whose tests
// are all skipped or todo still counts.
const fitnessDescribe =
  /(?:(?<![\w"'`.])describe\(|\)\()\s*["'`]fitness: (.+?) \(([a-z0-9-]+)\.md\)/gu;

export function fitnessTests(): {
  name: string;
  constraint: string;
  path: string;
}[] {
  return repoFiles()
    .filter((path) => tiers.some((tier) => path.endsWith(tier.suffix)))
    .flatMap((path) =>
      [...readRepoFile(path).matchAll(fitnessDescribe)].map((match) => ({
        name: match[1] ?? "",
        constraint: match[2] ?? "",
        path,
      })),
    );
}

// A record's table names a check without its article ("Idle poll is
// cheap"), and a describe name reads as a sentence ("an idle poll is
// cheap").
export const asNamed = (name: string): string =>
  name.toLowerCase().replace(/^(?:the|an|a) /u, "");
