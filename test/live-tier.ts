// Reads the live tier's own source for the static checks of ADR 16.
import { dirname, join } from "node:path/posix";
import ts from "typescript";
import { readRepoFile, repoFiles } from "./repo";

// Every *.live.ts file, and every repo file one imports, however deep.
let live: string[] | undefined;
export function liveTierFiles(): string[] {
  live ??= findLiveTierFiles();
  return [...live];
}

function findLiveTierFiles(): string[] {
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

// Every email address written in a piece of source, and every domain
// written with its @, so an address split across strings is found too.
export function addressesIn(text: string): string[] {
  return text.match(/[\w.%+-]*@[\w-]+(?:\.[\w-]+)+/gu) ?? [];
}

export function constantFor(text: string, value: string): string | undefined {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^(?:export )?const (\\w+) = "${escaped}";$`, "mu").exec(
    text,
  )?.[1];
}

// Each line that uses a constant other than as it is. As it is means its
// declaration, an import under its own name, or a whole argument to a call
// that is not a String method building a new string. The source is parsed,
// so strings, comments and parentheses around the constant do not mislead.
export function builtFrom(text: string, name: string): string[] {
  const source = parse(text);
  const lines = text.split("\n");
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === name && !usedAsItIs(node)) {
      const { line } = source.getLineAndCharacterOfPosition(
        node.getStart(source),
      );
      found.push((lines[line] ?? "").trim());
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function usedAsItIs(node: ts.Identifier): boolean {
  const { parent } = node;
  if (ts.isVariableDeclaration(parent)) {
    return (
      parent.name === node &&
      parent.initializer !== undefined &&
      ts.isStringLiteral(parent.initializer) &&
      (parent.parent.flags & ts.NodeFlags.Const) !== 0
    );
  }
  if (ts.isImportSpecifier(parent)) return parent.propertyName === undefined;
  return (
    (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
    !(
      ts.isPropertyAccessExpression(parent.expression) &&
      building.has(parent.expression.name.text)
    ) &&
    (parent.arguments ?? []).some((argument) => argument === node)
  );
}

// The String methods that put an argument into the string they return.
const building = new Set([
  "concat",
  "padEnd",
  "padStart",
  "replace",
  "replaceAll",
]);

const typing = new Set(["fill", "type", "pressSequentially", "insertText"]);

export function typedValues(text: string): string[] {
  const source = parse(text);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      typing.has(node.expression.name.text)
    ) {
      found.push(node.arguments[0]?.getText(source) ?? "");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const pressable = new Set([
  "button",
  "checkbox",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "switch",
  "tab",
]);

// A name written as a plain string comes back in double quotes, and a
// missing one as "(no name)". A role not written as a string counts as
// pressable, so none slips past, and getByRole is found however it is
// called.
export function controlNames(text: string): string[] {
  const source = parse(text);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && calledName(node) === "getByRole") {
      const [role, options] = node.arguments;
      if (
        role !== undefined &&
        (!ts.isStringLiteralLike(role) || pressable.has(role.text))
      ) {
        found.push(nameIn(options, source));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function calledName(call: ts.CallExpression): string | undefined {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  if (
    ts.isElementAccessExpression(callee) &&
    ts.isStringLiteralLike(callee.argumentExpression)
  ) {
    return callee.argumentExpression.text;
  }
  return undefined;
}

function nameIn(
  options: ts.Expression | undefined,
  source: ts.SourceFile,
): string {
  if (options === undefined) return "(no name)";
  if (!ts.isObjectLiteralExpression(options)) return options.getText(source);
  const name = options.properties.find(
    (property) =>
      property.name !== undefined &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === "name",
  );
  if (name === undefined) return "(no name)";
  if (!ts.isPropertyAssignment(name)) return name.getText(source);
  return ts.isStringLiteralLike(name.initializer)
    ? JSON.stringify(name.initializer.text)
    : name.initializer.getText(source);
}

function parse(text: string): ts.SourceFile {
  return ts.createSourceFile(
    "source.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}
