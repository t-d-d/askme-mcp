import { describe, expect, it } from "vitest";
import { defaultModel } from "../service/src/model";
import { readRepoFile } from "../test/repo";
import { candidates } from "./candidates";
import { cases } from "./cases";
import { capital } from "./score";

const saved = readRepoFile("evals/scores.md");
const readme = readRepoFile("README.md");

// The table headed "| Model |", from its header to the first line that is
// not a row.
function modelTable(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith("| Model |"));
  if (start === -1) return [];
  const end = lines.findIndex(
    (line, at) => at > start && !line.startsWith("|"),
  );
  return lines.slice(start, end === -1 ? undefined : end);
}

// The README writes small numbers as words and larger ones as digits.
const numberWords = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

function counted(word: string): number {
  return /^\d+$/u.test(word) ? Number(word) : numberWords.indexOf(word);
}

// "once", "twice" or "<number> times".
function timesCounted(phrase: string): number {
  if (phrase === "once") return 1;
  if (phrase === "twice") return 2;
  return counted(phrase.replace(/ times$/u, ""));
}

// The README's sentence on the run of the candidates: the number of models,
// then the rounds.
function candidatesRun(): RegExpExecArray | null {
  return /`npm run eval:candidates` sent each of them to (\w+) [^.]*?models (once|twice|\w+ times)\b/u.exec(
    readme,
  );
}

// The README names a model as its id without the maker, in words: "Claude
// Haiku 5.5" for anthropic/claude-haiku-5.5.
function asName(model: string): string {
  return model.slice(model.indexOf("/") + 1);
}

function nameAsId(name: string | undefined): string | undefined {
  return name?.toLowerCase().replaceAll(" ", "-");
}

const best = /^Best: `([^`]+)`$/mu.exec(saved)?.[1];

describe("the saved scores", () => {
  it("name the default model as the best", () => {
    expect(best).toBe(defaultModel);
  });

  it("hold a line for every candidate, and no other model", () => {
    const rows = [...saved.matchAll(/^\| `([^`]+)` \|/gmu)].map(
      ([, model]) => model,
    );
    expect(rows.sort()).toEqual([...candidates].sort());
  });

  // Order is not checked: each row follows the header's order.
  it("have a column for every group in the eval set, and no other group", () => {
    const header = (/^\| Model \|(.*)$/mu.exec(saved)?.[1] ?? "")
      .split("|")
      .map((cell) => cell.trim());
    expect(header).toContain("All");
    const columns = header.slice(0, header.indexOf("All"));
    const groups = [...new Set(cases.map(({ group }) => group))].map(capital);
    expect(columns.sort()).toEqual(groups.sort());
  });
});

describe("the README's eval section", () => {
  it("copies the saved scores' table, its header included", () => {
    const table = modelTable(saved);
    expect(table.length).toBeGreaterThan(2);
    expect(modelTable(readme)).toEqual(table);
  });

  it("gives the number of asks in the eval set, and in each group", () => {
    const sentence = /^The eval set holds (\d+) asks: ([^.]+)\./mu.exec(readme);
    expect(sentence).not.toBeNull();
    const [, total, groups = ""] = sentence ?? [];
    const parts = groups.split(/,? and |, /u);
    const stated = Object.fromEntries(
      parts.map((part) => {
        const [, count, group] = /^(\d+) (\w+)$/u.exec(part) ?? [];
        return [group ?? part, Number(count)];
      }),
    );
    const inSet: Record<string, number> = {};
    for (const { group } of cases) inSet[group] = (inSet[group] ?? 0) + 1;
    expect(Number(total)).toBe(cases.length);
    // A group named twice would otherwise count only once.
    expect(Object.keys(stated)).toHaveLength(parts.length);
    expect(stated).toEqual(inSet);
  });

  it("gives the number of candidates", () => {
    const run = candidatesRun();
    expect(run).not.toBeNull();
    expect(counted(run?.[1] ?? "")).toBe(candidates.length);
  });

  it("gives the rounds the saved scores state", () => {
    const stated = /sent every ask in the eval set (\d+) times/u.exec(saved);
    expect(stated).not.toBeNull();
    const run = candidatesRun();
    expect(run).not.toBeNull();
    expect(timesCounted(run?.[2] ?? "")).toBe(Number(stated?.[1]));
  });

  it("names the saved scores' best model in its heading", () => {
    expect(best).toBeDefined();
    const heading = /^### Why (.+)$/mu.exec(readme)?.[1];
    expect(nameAsId(heading)).toBe(asName(best ?? ""));
  });

  it("names the saved scores' best model as the one that scored best", () => {
    expect(best).toBeDefined();
    const paragraph = /^The eval set holds .*$/mu.exec(readme)?.[0] ?? "";
    // A name such as "Claude Haiku 5.5" holds a dot, but no dot and space.
    const sentence = paragraph
      .split(". ")
      .find((one) => one.includes(" scored best"));
    const named = /^(.+) scored best/u.exec(sentence ?? "")?.[1];
    expect(nameAsId(named)).toBe(asName(best ?? ""));
  });
});

describe("the candidates", () => {
  it("include the default model, so each run measures it too", () => {
    expect(candidates).toContain(defaultModel);
  });

  it("name each model once", () => {
    expect(new Set(candidates).size).toBe(candidates.length);
  });
});
