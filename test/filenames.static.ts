// On a case-insensitive file system, as a Mac has by default, an import of
// "./Asks" can find asks.ts instead of Asks.tsx, and tsc stops with TS1149.
// Two files whose whole names differ only in case cannot both be checked out
// there at all. Either way the gate fails on a Mac, though it passes on Linux
// in CI. A Mac also reads two spellings of an accented letter as one: é as
// one code point, or as e followed by a combining accent.
import { extname } from "node:path";
import { describe, expect, it } from "vitest";
import { repoFiles } from "./repo";

// A file's name as an import writes it, without its extension, and the name
// of each folder above it, so web/src/Asks.tsx gives web, web/src and
// web/src/Asks. A declaration file's ".d.ts" is all extension, so an import
// of "./vite-env" names web/src/vite-env.d.ts.
const declaration = /\.d\.[cm]?ts$/u;
const withoutExtension = (path: string): string =>
  declaration.test(path)
    ? path.replace(declaration, "")
    : path.slice(0, path.length - extname(path).length);
const names = (path: string): string[] => {
  const parts = withoutExtension(path).split("/");
  return parts.map((_, end) => parts.slice(0, end + 1).join("/"));
};

describe("the repo's file names", () => {
  it("has no two files or folders whose names differ only in case or in how a letter is spelt", () => {
    const spellings = new Map<string, Set<string>>();
    for (const name of repoFiles().flatMap(names)) {
      const key = name.normalize("NFD").toLowerCase();
      spellings.set(key, (spellings.get(key) ?? new Set()).add(name));
    }
    const clashes = [...spellings.values()]
      .filter((spelt) => spelt.size > 1)
      .map((spelt) => [...spelt]);
    expect(clashes).toEqual([]);
  });
});
