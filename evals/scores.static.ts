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

describe("the saved scores", () => {
  it("name the default model as the best", () => {
    expect(/^Best: `([^`]+)`$/mu.exec(saved)?.[1]).toBe(defaultModel);
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
});

describe("the candidates", () => {
  it("include the default model, so each run measures it too", () => {
    expect(candidates).toContain(defaultModel);
  });

  it("name each model once", () => {
    expect(new Set(candidates).size).toBe(candidates.length);
  });
});
