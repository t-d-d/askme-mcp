import { describe, expect, it } from "vitest";
import { readRepoFile, scripts } from "../test/repo";

const source = readRepoFile("evals/run.eval.ts");
const call = readRepoFile("evals/sorting.ts");

// The patterns take the whole value up to its comma, so `sortMaxTokens * 2`
// is not read as `sortMaxTokens`, and match only at a line's start, so a
// comment that names a field does not count.
const given = (pattern: RegExp) =>
  [...call.matchAll(pattern)].map(([, value = ""]) => value.trim());

const fromSorter = () =>
  /import \{([^}]*)\} from "\.\.\/service\/src\/sorter";/u
    .exec(call)?.[1]
    ?.split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "") ?? [];

describe("the eval calls the model as the sorter does", () => {
  it("imports the sorter's token cap and timeout", () => {
    expect(fromSorter()).toEqual(
      expect.arrayContaining(["sortMaxTokens", "sortTimeoutMs"]),
    );
  });

  it("sends the sorter's token cap, and no number of its own", () => {
    expect(given(/^ *maxTokens: *([^,\n]+)/gmu)).toEqual(["sortMaxTokens"]);
  });

  it("sends the sorter's timeout, and no number of its own", () => {
    expect(given(/^ *timeoutMs: *([^,\n]+)/gmu)).toEqual(["sortTimeoutMs"]);
  });
});

describe("the eval and the trial share one call", () => {
  it.each(["evals/run.eval.ts", "evals/trial.eval.ts"])(
    "%s sorts through evals/sorting.ts, with no request of its own",
    (path) => {
      const text = readRepoFile(path);
      expect(text).toMatch(
        /^import \{[^}]*\bsortEvalAsk\b[^}]*\} from "\.\/sorting";$/mu,
      );
      expect(text).not.toMatch(/^ *(?:maxTokens|timeoutMs):/mu);
    },
  );
});

describe("the eval across the candidates", () => {
  it("has a command of its own, which runs the eval with every candidate", () => {
    expect(scripts()["eval:candidates"]).toBe("EVAL_CANDIDATES=1 npm run eval");
  });

  it("reads the candidates from their list", () => {
    expect(source).toMatch(
      /^import \{ candidates \} from "\.\/candidates";$/mu,
    );
  });
});
