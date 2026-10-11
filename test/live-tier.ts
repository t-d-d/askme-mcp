// The live tier's own source, read for the static checks of ADR 16: the
// files it runs and imports, the addresses they hold, and what they type.
import { dirname, join } from "node:path/posix";
import { readRepoFile, repoFiles } from "./repo";

// Every *.live.ts file, and every file in the repo that one imports, however
// deep. A package's files are not the repo's, so they are left out.
export function liveTierFiles(): string[] {
  const files = new Set(repoFiles());
  const seen = new Set<string>();
  const visit = (path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    for (const specifier of relativeImports(readRepoFile(path))) {
      visit(resolveImport(path, specifier, files));
    }
  };
  for (const path of files) if (path.endsWith(".live.ts")) visit(path);
  return [...seen].sort();
}

function relativeImports(text: string): string[] {
  return [
    ...text.matchAll(
      /(?:\bfrom|\bimport|\bimport\()\s*["'](\.{1,2}\/[^"']+)["']/gu,
    ),
  ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
}

function resolveImport(
  from: string,
  specifier: string,
  files: Set<string>,
): string {
  const base = join(dirname(from), specifier);
  const found = ["", ".ts", ".tsx", "/index.ts"]
    .map((ending) => `${base}${ending}`)
    .find((path) => files.has(path));
  if (found === undefined) {
    throw new Error(`${from} imports ${specifier}, which is not in the repo.`);
  }
  return found;
}

// Every email address written in a piece of source.
export function addressesIn(text: string): string[] {
  return text.match(/[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/gu) ?? [];
}

// The name of the constant that holds a string, as `const name = "value";`.
export function constantFor(text: string, value: string): string | undefined {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^(?:export )?const (\\w+) = "${escaped}";$`, "mu").exec(
    text,
  )?.[1];
}

// Each line where a constant is used other than as it is: as one whole
// argument to a call. Its declaration, and a line that imports it by name,
// are the only other places it may appear.
export function builtFrom(text: string, name: string): string[] {
  const lineAt = (index: number) =>
    text.slice(
      text.lastIndexOf("\n", index) + 1,
      text.indexOf("\n", index) === -1 ? undefined : text.indexOf("\n", index),
    );
  const declaration = new RegExp(`^(?:export )?const ${name} = "[^"]*";$`, "u");
  const importLine = new RegExp(
    `^import \\{[^}]*\\b${name}\\b[^}]*\\} from "[^"]+";$`,
    "u",
  );
  return [...text.matchAll(new RegExp(`\\b${name}\\b`, "gu"))]
    .filter(({ index }) => {
      const line = lineAt(index).trim();
      if (declaration.test(line) || importLine.test(line)) return false;
      const before = text.slice(0, index).trimEnd().at(-1);
      const after = text
        .slice(index + name.length)
        .trimStart()
        .at(0);
      return !(
        openerAt(text, index) === "(" &&
        (before === "(" || before === ",") &&
        (after === ")" || after === ",")
      );
    })
    .map(({ index }) => lineAt(index).trim());
}

// The bracket left open around a place in the source.
function openerAt(text: string, index: number): string | undefined {
  let depth = 0;
  for (let at = index - 1; at >= 0; at -= 1) {
    const char = text.charAt(at);
    if (")]}".includes(char)) depth += 1;
    if ("([{".includes(char)) {
      if (depth === 0) return char;
      depth -= 1;
    }
  }
  return undefined;
}

// The first argument of every call that types into a page: fill, type,
// pressSequentially and insertText, as written in the source.
export function typedValues(text: string): string[] {
  return [
    ...text.matchAll(/\.(?:fill|type|pressSequentially|insertText)\(/gu),
  ].map(({ index, 0: call }) => firstArgument(text, index + call.length));
}

function firstArgument(text: string, start: number): string {
  let depth = 0;
  for (let at = start; at < text.length; at += 1) {
    const char = text.charAt(at);
    if (depth === 0 && (char === "," || char === ")")) {
      return text.slice(start, at).trim();
    }
    if ("([{".includes(char)) depth += 1;
    if (")]}".includes(char)) depth -= 1;
  }
  return text.slice(start).trim();
}
