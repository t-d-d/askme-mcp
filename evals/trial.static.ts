import { describe, expect, it } from "vitest";
import { readRepoFile, scripts } from "../test/repo";
import { tiers } from "../test/tiers";

const trialPath = "evals/trial.eval.ts";
const source = readRepoFile(trialPath);

describe("the trial of a draft wording", () => {
  it("has a command of its own, which runs the trial's file alone", () => {
    expect(scripts()["eval:trial"]).toBe(
      `EVAL_TRIAL=1 npm run eval -- ${trialPath}`,
    );
  });

  it("runs only when its command asks, so npm run eval skips it", () => {
    expect(source).toMatch(
      /describe\.runIf\(process\.env\.EVAL_TRIAL === "1"\)/u,
    );
  });

  it("reaches the model as the eval does, and sends no key of its own", () => {
    expect(source).toMatch(
      /^import \{[^}]*\bclientFor\b[^}]*\bevalKey\b[^}]*\} from "\.\/model";$/mu,
    );
    expect(source).not.toMatch(/OPENROUTER_API_KEY|Authorization|Bearer/u);
  });
});

describe("fitness: the trial is not in the gate (test-tiers.md)", () => {
  it("has a name no tier in the gate runs", () => {
    const inGate = tiers.filter(({ inGate }) => inGate);
    expect(inGate.length).toBeGreaterThan(0);
    for (const { suffix } of inGate) {
      expect(trialPath.endsWith(suffix)).toBe(false);
    }
  });
});
