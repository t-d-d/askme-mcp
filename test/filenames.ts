// A Mac's disk reads names that differ only in case, or in how an accented
// letter is spelt, as one. Then an import can find the wrong file, and tsc
// stops with TS1149, or two files cannot both be checked out, though the
// gate passes on Linux.
import { extname } from "node:path";

// web/src/Asks.tsx gives web, web/src, web/src/Asks.tsx and, as an import
// writes it, web/src/Asks. A declaration file's ".d.ts" is all extension,
// so an import of "./vite-env" names web/src/vite-env.d.ts.
const declaration = /\.d\.[cm]?ts$/u;
const withoutExtension = (path: string): string =>
  declaration.test(path)
    ? path.replace(declaration, "")
    : path.slice(0, path.length - extname(path).length);
const entries = (path: string): string[] => {
  const parts = path.split("/");
  return parts.map((_, end) => parts.slice(0, end + 1).join("/"));
};
const names = (path: string): string[] => [
  ...entries(path),
  withoutExtension(path),
];

const together = (group: Iterable<string>): string =>
  JSON.stringify([...group].sort());

// Two spellings of é print alike, so a clash shows each character outside
// ASCII as its code point: caf\u{e9}, then cafe\u{301}.
const visible = (name: string): string =>
  name.replace(
    /[^\x20-\x7e]/gu,
    (letter) => `\\u{${(letter.codePointAt(0) ?? 0).toString(16)}}`,
  );

// A Mac's disk compares names by case folding, which JavaScript lacks. It
// joins ς and σ, ſ and s, and ß and ss, which toLowerCase keeps apart. Lower,
// upper, then lower again joins the same letters, as Python's str.casefold()
// does on every character Unicode 15.1 assigns, except that it turns the
// dotless ı (\u0131) into i, so ı is kept out of it. Unicode's caseless match
// normalizes a name before and after folding it.
const fold = (name: string): string =>
  name
    .normalize("NFD")
    .split("\u0131")
    .map((part) => part.toLowerCase().toUpperCase().toLowerCase())
    .join("\u0131")
    .normalize("NFD");

export function clashes(paths: readonly string[]): string[][] {
  const spellings = new Map<string, Set<string>>();
  for (const name of new Set(paths.flatMap(names))) {
    const key = fold(name);
    spellings.set(key, (spellings.get(key) ?? new Set()).add(name));
  }
  const groups = [...spellings.values()].filter((spelt) => spelt.size > 1);
  // A.md beside a.md clashes twice, as A.md and a.md, and as A and a. The
  // files' group is left out when their bare names make up another group and
  // nothing on the disk has one of those names, as it says the same thing.
  const files = new Set(paths);
  const onDisk = new Set(paths.flatMap(entries));
  const listed = new Set(groups.map(together));
  const repeats = (spelt: Set<string>): boolean => {
    const bare = [...spelt].map(withoutExtension);
    return (
      [...spelt].every((name) => files.has(name)) &&
      listed.has(together(bare)) &&
      !bare.some((name) => onDisk.has(name))
    );
  };
  return groups
    .filter((spelt) => !repeats(spelt))
    .map((spelt) => [...spelt].map(visible));
}
