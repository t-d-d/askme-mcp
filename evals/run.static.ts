// The eval sends the sorter's own token cap and timeout, so a change to
// either in the service reaches the eval too, and its scores go on
// describing the service's call. The eval and the trial make that call in
// one module, and run only by hand, so this reads their source.
import { describe, expect, it } from "vitest";
import { readRepoFile, scripts } from "../test/repo";

const source = readRepoFile("evals/run.eval.ts");
const call = readRepoFile("evals/sorting.ts");

// What each mention of a field in the eval is given: the whole value, up to
// its comma or the end of its line, so `sortMaxTokens * 2` is not read as
// `sortMaxTokens`. A field counts only at the start of a line, so a comment
// that names one is not read as sending it.
const given = (pattern: RegExp) =>
  [...call.matchAll(pattern)].map(([, value = ""]) => value.trim());

// The names the eval imports from the sorter.
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
