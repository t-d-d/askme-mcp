// On a case-insensitive file system, as a Mac has by default, an import of
// "./Asks" can find asks.ts instead of Asks.tsx, and tsc stops with TS1149.
// Two files whose whole names differ only in case cannot both be checked out
// there at all. Either way the gate fails on a Mac, though it passes on Linux
// in CI.
import { extname } from "node:path";
import { describe, expect, it } from "vitest";
import { repoFiles } from "./repo";

// A file's name as an import writes it, without its extension, and the name
// of each folder above it, so web/src/Asks.tsx gives web, web/src and
// web/src/Asks.
const names = (path: string): string[] => {
  const parts = path.slice(0, path.length - extname(path).length).split("/");
  return parts.map((_, end) => parts.slice(0, end + 1).join("/"));
};

describe("the repo's file names", () => {
  it("has no two files or folders whose names differ only in case", () => {
    const spellings = new Map<string, Set<string>>();
    for (const name of repoFiles().flatMap(names)) {
      const key = name.toLowerCase();
      spellings.set(key, (spellings.get(key) ?? new Set()).add(name));
    }
    const clashes = [...spellings.values()]
      .filter((spelt) => spelt.size > 1)
      .map((spelt) => [...spelt]);
    expect(clashes).toEqual([]);
  });
});
