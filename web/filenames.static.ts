// On a case-insensitive file system, as a Mac has by default, an import of
// "./Asks" can find asks.ts instead of Asks.tsx. The page's types, its build
// and its browser tests then fail there, though they pass on Linux in CI.
import { basename, dirname, extname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoFiles } from "../test/repo";

describe("the page's file names", () => {
  it("has no two files in web/src whose names differ only in case", () => {
    const spellings = new Map<string, Set<string>>();
    for (const path of repoFiles().filter((file) =>
      file.startsWith("web/src/"),
    )) {
      const name = join(dirname(path), basename(path, extname(path)));
      const key = name.toLowerCase();
      spellings.set(key, (spellings.get(key) ?? new Set()).add(name));
    }
    const clashes = [...spellings.values()]
      .filter((names) => names.size > 1)
      .map((names) => [...names]);
    expect(clashes).toEqual([]);
  });
});
