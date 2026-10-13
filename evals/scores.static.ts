// The scores saved by the last run across the candidates, and the default
// model they chose (PRD, "Stack": the model that sorts is chosen with the
// eval set). The run itself is not in the gate, so this reads its file.
import { describe, expect, it } from "vitest";
import { defaultModel } from "../service/src/model";
import { readRepoFile } from "../test/repo";
import { candidates } from "./candidates";
import { cases } from "./cases";

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

  // The table's group columns run from after Model to before All, each named
  // with a capital, as the run writes them.
  it("have a column for every group in the eval set, and no other group", () => {
    const header = (/^\| Model \|.*$/mu.exec(saved)?.[0] ?? "")
      .split("|")
      .map((cell) => cell.trim().toLowerCase())
      .filter((cell) => cell !== "");
    const columns = header.slice(1, header.indexOf("all"));
    const groups = [...new Set(cases.map(({ group }) => group))];
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
