// The eval sends the sorter's own token cap and timeout, so a change to
// either in the service reaches the eval too, and its scores go on
// describing the service's call. The eval runs only with `npm run eval`, so
// this reads its source.
import { describe, expect, it } from "vitest";
import { readRepoFile } from "../test/repo";

const source = readRepoFile("evals/run.eval.ts");

// What each mention of a field in the eval is given.
const given = (pattern: RegExp) =>
  [...source.matchAll(pattern)].map(([, value]) => value);

// The names the eval imports from the sorter.
const fromSorter = () =>
  /import \{([^}]*)\} from "\.\.\/service\/src\/sorter";/u
    .exec(source)?.[1]
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
    expect(given(/\bmaxTokens:\s*([^,\s]+)/gu)).toEqual(["sortMaxTokens"]);
  });

  it("sends the sorter's timeout, and no number of its own", () => {
    expect(given(/\btimeoutMs:\s*([^,\s]+)/gu)).toEqual(["sortTimeoutMs"]);
  });
});
