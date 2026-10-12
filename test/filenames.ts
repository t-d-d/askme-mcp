// On a case-insensitive file system, as a Mac has by default, an import of
// "./Asks" can find asks.ts instead of Asks.tsx, and tsc stops with TS1149.
// Two files whose whole names differ only in case cannot both be checked out
// there at all. Either way the gate fails on a Mac, though it passes on Linux
// in CI. A Mac also reads two spellings of an accented letter as one: é as
// one code point, or as e followed by a combining accent. Nobody has tried
// each letter on a Mac, so the check follows Unicode's rules, which Apple's
// disks may not match in every letter.
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

// A Mac's disk compares names by case folding. Unicode's case folding joins ς
// and σ, ſ and s, and ß and ss, which toLowerCase keeps apart, and a Mac may
// not join every one of them. JavaScript has no case folding. Lower case,
// then upper, then lower again joins the same letters as Unicode's folding,
// with one exception. It turns the Turkish dotless ı (\u0131) into i, and
// Unicode's folding keeps the two apart. This matched Python's
// str.casefold(), which reads Unicode's own table, on every character Unicode
// 15.1 assigns. Unicode's caseless match normalizes a name before and after
// folding it.
const fold = (name: string): string =>
  name
    .normalize("NFD")
    .split("\u0131")
    .map((part) => part.toLowerCase().toUpperCase().toLowerCase())
    .join("\u0131")
    .normalize("NFD");

// The names among these paths that a Mac would read as one, each group
// listed by its spellings.
export function clashes(paths: readonly string[]): string[][] {
  const spellings = new Map<string, Set<string>>();
  for (const name of new Set(paths.flatMap(names))) {
    const key = fold(name);
    spellings.set(key, (spellings.get(key) ?? new Set()).add(name));
  }
  return [...spellings.values()]
    .filter((spelt) => spelt.size > 1)
    .map((spelt) => [...spelt].map(visible));
}
