import { describe, expect, it } from "vitest";
import { defaultModel } from "../service/src/model";
import { readRepoFile } from "../test/repo";
import { candidates } from "./candidates";
import { cases } from "./cases";
import { capital } from "./score";

const saved = readRepoFile("evals/scores.md");

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

describe("the candidates", () => {
  it("include the default model, so each run measures it too", () => {
    expect(candidates).toContain(defaultModel);
  });

  it("name each model once", () => {
    expect(new Set(candidates).size).toBe(candidates.length);
  });
});
