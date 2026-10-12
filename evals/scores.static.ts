// The scores saved by the last run across the candidates, and the default
// model they chose (PRD, "Stack": the model that sorts is chosen with the
// eval set). The run itself is not in the gate, so this reads its file.
import { describe, expect, it } from "vitest";
import { defaultModel } from "../service/src/model";
import { readRepoFile } from "../test/repo";
import { candidates } from "./candidates";

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
});

describe("the candidates", () => {
  it("include the default model, so each run measures it too", () => {
    expect(candidates).toContain(defaultModel);
  });

  it("name each model once", () => {
    expect(new Set(candidates).size).toBe(candidates.length);
  });
});
