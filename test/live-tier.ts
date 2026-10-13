// The live tier's own source, read for the static checks of ADR 16: the
// files it runs and imports, the addresses they hold, and what they type.
import { dirname, join } from "node:path/posix";
import ts from "typescript";
import { readRepoFile, repoFiles } from "./repo";

// Every *.live.ts file, and every file in the repo that one imports, however
// deep. A package's files are not the repo's, so they are left out. The
// list is worked out once per test file.
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

// The name of the constant that holds a string, as `const name = "value";`.
export function constantFor(text: string, value: string): string | undefined {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^(?:export )?const (\\w+) = "${escaped}";$`, "mu").exec(
    text,
  )?.[1];
}

// Each line where a constant is used other than as it is: as one whole
// argument to a call, unless the call is a String method that puts its
// argument into the string it returns. Its declaration, and an import of
// it under its own name, are the only other places it may appear. The
// source is read as TypeScript, so brackets and commas inside strings and
// comments, and a constant wrapped in parentheses, are seen for what they
// are.
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

// The calls that type into a page.
const typing = new Set(["fill", "type", "pressSequentially", "insertText"]);

// The first argument of every call that types into a page: fill, type,
// pressSequentially and insertText, as written in the source.
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

// Node's file modules, by any name they can be imported under.
const fileModules = new Set([
  "fs",
  "node:fs",
  "fs/promises",
  "node:fs/promises",
]);

// What a piece of source takes from Node's file modules (ADR 23): each
// function imported by name, under the name it has there, "default" for a
// default import, and "*" for the whole module, however it is reached: a
// namespace import, an import with require, a dynamic import or require.
export function fileSystemImports(text: string): string[] {
  const source = parse(text);
  const found: string[] = [];
  const fromFiles = (node: ts.Node | undefined): boolean =>
    node !== undefined &&
    ts.isStringLiteralLike(node) &&
    fileModules.has(node.text);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && fromFiles(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (clause?.name !== undefined) found.push("default");
      const bindings = clause?.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
        found.push("*");
      } else if (bindings !== undefined) {
        for (const element of bindings.elements) {
          found.push((element.propertyName ?? element.name).text);
        }
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      fromFiles(node.moduleReference.expression)
    ) {
      found.push("*");
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require")) &&
      fromFiles(node.arguments[0])
    ) {
      found.push("*");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

// The roles a person presses, ticks or picks on a page.
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

// The name of every control a person presses found by its role, as written
// in the source with a plain string in double quotes, or "(no name)" when
// none is given. A role not written as a string counts as pressed, so it
// cannot slip past, and so does getByRole called by any route: on a page or
// a locator, by its bracketed name, or taken off one as a plain function.
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
