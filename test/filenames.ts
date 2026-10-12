// On a case-insensitive file system, as a Mac has by default, an import of
// "./Asks" can find asks.ts instead of Asks.tsx, and tsc stops with TS1149.
// Two files whose whole names differ only in case cannot both be checked out
// there at all. Either way the gate fails on a Mac, though it passes on Linux
// in CI. A Mac also reads two spellings of an accented letter as one: é as
// one code point, or as e followed by a combining accent.
import { extname } from "node:path";

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

// Two spellings of é print alike, so a clash shows each character outside
// ASCII as its code point: caf\u{e9}, then cafe\u{301}.
const visible = (name: string): string =>
  name.replace(
    /[^\x20-\x7e]/gu,
    (letter) => `\\u{${(letter.codePointAt(0) ?? 0).toString(16)}}`,
  );

// The names among these paths that a Mac would read as one, each group
// listed by its spellings.
export function clashes(paths: readonly string[]): string[][] {
  const spellings = new Map<string, Set<string>>();
  for (const name of paths.flatMap(names)) {
    const key = name.normalize("NFD").toLowerCase();
    spellings.set(key, (spellings.get(key) ?? new Set()).add(name));
  }
  return [...spellings.values()]
    .filter((spelt) => spelt.size > 1)
    .map((spelt) => [...spelt].map(visible));
}
