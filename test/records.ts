// The decision records' fitness tables, and the fitness tests that answer
// them, read from the repo's own files for static tests.
import { readRepoFile, repoFiles } from "./repo";
import { tiers } from "./tiers";

const recordPath = /^docs\/adr\/(\d{4})-[a-z0-9-]+\.md$/u;
const constraintPath = /^docs\/constraints\/([a-z0-9-]+)\.md$/u;

// Every decision record, by number, in order.
export function records(): { record: number; path: string }[] {
  return repoFiles()
    .flatMap((path) => {
      const number = recordPath.exec(path)?.[1];
      return number === undefined ? [] : [{ record: Number(number), path }];
    })
    .sort((a, b) => a.record - b.record);
}

// The checks in a record's "Fitness functions" table, in order: the first
// cell of each row below the header.
export function checksIn(text: string): string[] {
  const start = text.indexOf("\n## Fitness functions\n");
  if (start === -1) return [];
  const rest = text.slice(start + 1);
  const end = rest.indexOf("\n## ");
  const section = end === -1 ? rest : rest.slice(0, end);
  return section
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .slice(2)
    .map((row) => row.split("|")[1]?.trim() ?? "")
    .filter((name) => name !== "");
}

// Each constraint file, without its .md, and the records its History line
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

// Every fitness test in a test file of any tier, as CLAUDE.md names one:
// `fitness: <what it asserts> (<file>.md)`.
export function fitnessTests(): {
  name: string;
  constraint: string;
  path: string;
}[] {
  return repoFiles()
    .filter((path) => tiers.some((tier) => path.endsWith(tier.suffix)))
    .flatMap((path) =>
      [
        ...readRepoFile(path).matchAll(
          /["'`]fitness: (.+?) \(([a-z0-9-]+)\.md\)/gu,
        ),
      ].map((match) => ({
        name: match[1] ?? "",
        constraint: match[2] ?? "",
        path,
      })),
    );
}

// A check's name as a test gives it: in lower case, and with or without a
// leading article, as a sentence needs one.
export const asNamed = (name: string): string =>
  name.toLowerCase().replace(/^(?:the|an|a) /u, "");
