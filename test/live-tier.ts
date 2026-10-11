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
// argument to a call that is not a String method that builds on it. Its
// declaration, and an import of it under its own name, are the only other
// places it may appear. The source is read as TypeScript, so brackets and
// commas inside strings and comments, and a constant wrapped in
// parentheses, are seen for what they are.
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
    !building.has(calleeName(parent.expression) ?? "") &&
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

// The calls that send a request of their own: fetch, the post, put and
// patch of Playwright's API requests, a route, which can rewrite what the
// page sends, and the browser's beacon and XMLHttpRequest.
const sending = new Set([
  "fetch",
  "post",
  "put",
  "patch",
  "route",
  "sendBeacon",
  "open",
]);

// The calls that run code in the page.
const inPage = new Set([
  "evaluate",
  "evaluateHandle",
  "evaluateAll",
  "$eval",
  "$$eval",
  "waitForFunction",
  "addInitScript",
  "addScriptTag",
]);

// Clerk's Frontend API starts a sign-up with a POST to /v1/client/sign_ups,
// and changes one with a PATCH below it.
const signUpPath = "sign_ups";

// Each call that sends a request of its own to Clerk's sign-up path, from
// Node or from the page, as `path: line`. A call sends when it is one of
// the sending calls, or runs a function or a script in the page that makes
// one. It goes to the path when what it is given names the path, written
// there or in a constant or function it names, in its own file or one it
// imports. So waiting for the answer to Clerk's own screens is not sending.
export function signUpRequests(sources: Record<string, string>): string[] {
  const { files, checker } = readProgram(sources);
  return files.flatMap((file) =>
    callsIn(file)
      .filter(
        (call) =>
          sends(call, checker) &&
          reach(call.arguments, checker).some((node) =>
            names(node, signUpPath),
          ),
      )
      .map((call) => where(file, call)),
  );
}

// Each call that runs code in the page that sets an input's value, as
// `path: line`. The code is followed to the functions and constants it
// names, and a script written as a string is read as code too.
export function valuesSetInPage(sources: Record<string, string>): string[] {
  const { files, checker } = readProgram(sources);
  return files.flatMap((file) =>
    callsIn(file)
      .filter(
        (call) =>
          inPage.has(calleeName(call.expression) ?? "") &&
          reach(call.arguments, checker).some(setsValue),
      )
      .map((call) => where(file, call)),
  );
}

// Whether a call sends a request: it is one of the sending calls, or the
// code it runs makes one. That code is what its callee names or, for a call
// that runs code in the page, what it is given. Reach follows every name
// in it however deep, so a sending call anywhere below is among what it
// finds.
function sends(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  if (isSending(call)) return true;
  const name = calleeName(call.expression);
  const runs =
    name !== undefined && inPage.has(name) ? call.arguments : [call.expression];
  return reach(runs, checker).some((node) => callsIn(node).some(isSending));
}

function isSending(call: ts.CallExpression): boolean {
  return sending.has(calleeName(call.expression) ?? "");
}

// The nodes given, and what every name in them is declared as, however
// deep: a constant's value, a function's body, the value a destructured
// name is taken from, and a parameter's default. A parameter is followed
// no further than its default.
function reach(nodes: readonly ts.Node[], checker: ts.TypeChecker): ts.Node[] {
  const found = new Set<ts.Node>();
  const follow = (node: ts.Node): void => {
    if (found.has(node)) return;
    found.add(node);
    const visit = (child: ts.Node): void => {
      if (ts.isIdentifier(child)) declaredAs(child, checker).forEach(follow);
      ts.forEachChild(child, visit);
    };
    visit(node);
  };
  nodes.forEach(follow);
  return [...found];
}

function declaredAs(name: ts.Identifier, checker: ts.TypeChecker): ts.Node[] {
  const symbol = checker.getSymbolAtLocation(name);
  const target =
    symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  return (target?.declarations ?? []).flatMap((declaration): ts.Node[] => {
    if (ts.isFunctionDeclaration(declaration)) {
      return declaration.body === undefined ? [] : [declaration.body];
    }
    return initializers(declaration);
  });
}

// The values a declared name is given: a constant's or a parameter's, and
// for a name destructured from one, its own default and the value of each
// pattern it sits in.
function initializers(declaration: ts.Node): ts.Node[] {
  if (
    !ts.isVariableDeclaration(declaration) &&
    !ts.isParameter(declaration) &&
    !ts.isBindingElement(declaration)
  ) {
    return [];
  }
  const own =
    declaration.initializer === undefined ? [] : [declaration.initializer];
  return ts.isBindingElement(declaration)
    ? [...own, ...initializers(declaration.parent.parent)]
    : own;
}

// Whether a string written anywhere in a node holds the text.
function names(node: ts.Node, text: string): boolean {
  if (
    (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) &&
    node.text.includes(text)
  ) {
    return true;
  }
  return (
    ts.forEachChild(node, (child) => names(child, text) || undefined) ?? false
  );
}

// The properties that hold what an input shows.
const valueNames = new Set(["value", "defaultValue"]);

// The calls that write a property given its name: setAttribute, Reflect's
// set, defineProperty, and getOwnPropertyDescriptor, whose setter writes
// past the page's own handlers.
const writingByName = new Set([
  "setAttribute",
  "set",
  "defineProperty",
  "getOwnPropertyDescriptor",
]);

// The calls that write each property of an object they are given:
// Object.assign and defineProperties.
const writingByObject = new Set(["assign", "defineProperties"]);

// The browser's own calls that put text into a field.
const inserting = new Set(["execCommand", "setRangeText"]);

// Whether code sets an input's value: it assigns to the value, writes it by
// name, or inserts text. A string is read as a script, since the page can
// run one.
function setsValue(node: ts.Node): boolean {
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
    valueNames.has(propertyName(node.left) ?? "")
  ) {
    return true;
  }
  if (ts.isCallExpression(node)) {
    const name = calleeName(node.expression) ?? "";
    if (inserting.has(name)) return true;
    if (
      writingByName.has(name) &&
      node.arguments.some(
        (argument) =>
          ts.isStringLiteralLike(argument) && valueNames.has(argument.text),
      )
    ) {
      return true;
    }
    if (
      writingByObject.has(name) &&
      node.arguments.some(
        (argument) =>
          ts.isObjectLiteralExpression(argument) &&
          argument.properties.some((property) =>
            valueNames.has(keyOf(property) ?? ""),
          ),
      )
    ) {
      return true;
    }
  }
  const script = scriptIn(node);
  if (script !== undefined && setsValue(parse(script))) return true;
  return (
    ts.forEachChild(node, (child) => setsValue(child) || undefined) ?? false
  );
}

// The key a property in an object literal is written under, when it is
// written as a name or a string.
function keyOf(property: ts.ObjectLiteralElementLike): string | undefined {
  const { name } = property;
  return name !== undefined &&
    (ts.isIdentifier(name) || ts.isStringLiteralLike(name))
    ? name.text
    : undefined;
}

// The text of a string, with each substitution in a template read as a
// name, so it can be parsed as a script.
function scriptIn(node: ts.Node): string | undefined {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return undefined;
  return [
    node.head.text,
    ...node.templateSpans.map((span) => `_${span.literal.text}`),
  ].join("");
}

// The name a call is made by: fetch in fetch(…), post in api.post(…) and
// api["post"](…), and concat in String.prototype.concat.call(…).
function calleeName(callee: ts.Expression): string | undefined {
  const name = ts.isIdentifier(callee) ? callee.text : propertyName(callee);
  if (
    (name === "call" || name === "apply") &&
    (ts.isPropertyAccessExpression(callee) ||
      ts.isElementAccessExpression(callee))
  ) {
    return calleeName(callee.expression) ?? name;
  }
  return name;
}

// The property an access names: value in input.value and input["value"].
function propertyName(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return node.argumentExpression.text;
  }
  return undefined;
}

// Every call in a node, the node itself included, outer before inner.
function callsIn(node: ts.Node): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  const visit = (child: ts.Node): void => {
    if (ts.isCallExpression(child)) found.push(child);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

// A call's file and the line it starts on.
function where(file: ts.SourceFile, call: ts.CallExpression): string {
  const { line } = file.getLineAndCharacterOfPosition(call.getStart(file));
  const text = file.text.split("\n")[line] ?? "";
  return `${file.fileName.slice(1)}: ${text.trim()}`;
}

// The sources read as one program, each file at its path, so the checker
// can follow a name to where it is declared, in its own file or one it
// imports. Nothing else is read, not even the standard library, so a name
// from a package or the browser is followed nowhere.
function readProgram(sources: Record<string, string>): {
  files: ts.SourceFile[];
  checker: ts.TypeChecker;
} {
  const texts = new Map(
    Object.entries(sources).map(([path, text]) => [`/${path}`, text]),
  );
  const host: ts.CompilerHost = {
    getSourceFile: (fileName, languageVersion) => {
      const text = texts.get(fileName);
      return text === undefined
        ? undefined
        : ts.createSourceFile(fileName, text, languageVersion, true);
    },
    getDefaultLibFileName: () => "/lib.d.ts",
    writeFile: () => undefined,
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (fileName) => texts.has(fileName),
    readFile: (fileName) => texts.get(fileName),
  };
  const program = ts.createProgram(
    [...texts.keys()],
    {
      noLib: true,
      noResolve: true,
      types: [],
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.Latest,
      noEmit: true,
    },
    host,
  );
  return {
    files: program.getSourceFiles().filter((file) => texts.has(file.fileName)),
    checker: program.getTypeChecker(),
  };
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
