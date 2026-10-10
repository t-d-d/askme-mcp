import { dirname, join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { eslint, importRefused, reported, rulesFor } from "../test/lint";
import { readRepoFile, repoFiles, root } from "../test/repo";

const strictOptions = [
  "strict",
  "noUncheckedIndexedAccess",
  "exactOptionalPropertyTypes",
  "noImplicitOverride",
  "noImplicitReturns",
  "noFallthroughCasesInSwitch",
  "noUnusedLocals",
  "noUnusedParameters",
] as const;

const configs = () =>
  repoFiles().filter((path) => /(?:^|\/)tsconfig[^/]*\.json$/u.test(path));

describe("fitness: strict options stay on (types-and-lint.md)", () => {
  it("finds the compiler configurations", () => {
    expect(configs()).toEqual(
      expect.arrayContaining([
        "tsconfig.base.json",
        "tsconfig.json",
        "web/tsconfig.json",
      ]),
    );
  });

  it.each(configs())("keeps every strictness option on in %s", (path) => {
    const file = join(root, path);
    const read = ts.readConfigFile(file, (name) => ts.sys.readFile(name));
    const config: unknown = read.config;
    const { options } = ts.parseJsonConfigFileContent(
      config,
      ts.sys,
      dirname(file),
    );
    for (const name of strictOptions) expect(options[name], name).toBe(true);
    expect(options.allowUnreachableCode).toBe(false);
    expect(options.allowUnusedLabels).toBe(false);
  });
});

describe("fitness: the escapes stay closed (types-and-lint.md)", () => {
  const escapes = [
    ["any", "export const a: any = 1;\n", "@typescript-eslint/no-explicit-any"],
    [
      "a non-null assertion",
      "export const b = [1].at(0)!;\n",
      "@typescript-eslint/no-non-null-assertion",
    ],
    [
      "@ts-ignore",
      "// @ts-ignore\nexport const c: number = 1;\n",
      "@typescript-eslint/ban-ts-comment",
    ],
    [
      "@ts-expect-error with no reason",
      '// @ts-expect-error\nexport const d: number = "1";\n',
      "@typescript-eslint/ban-ts-comment",
    ],
    [
      "an unsafe assertion",
      "const e: unknown = 1;\nexport const f = e as number;\n",
      "@typescript-eslint/no-unsafe-type-assertion",
    ],
    [
      "a rule switched off with no reason",
      "// eslint-disable-next-line @typescript-eslint/no-explicit-any\nexport const g: any = 1;\n",
      "@eslint-community/eslint-comments/require-description",
    ],
    [
      "a rule switched off for the whole file",
      "/* eslint-disable @typescript-eslint/no-explicit-any -- a reason */\nexport const h: any = 1;\n",
      "@eslint-community/eslint-comments/disable-enable-pair",
    ],
    [
      "a floating promise",
      "async function i(): Promise<void> {}\nexport function j(): void {\n  i();\n}\n",
      "@typescript-eslint/no-floating-promises",
    ],
  ] as const;

  for (const path of ["web/src/main.tsx", "test/repo.ts"]) {
    it.each(escapes)(`refuses %s in ${path}`, async (_, code, rule) => {
      expect(await reported(code, path)).toContain(rule);
    });
  }
});

describe("fitness: no warnings (types-and-lint.md)", () => {
  it("lets lint pass only with no warnings", () => {
    const { scripts } = z
      .object({ scripts: z.record(z.string(), z.string()) })
      .parse(JSON.parse(readRepoFile("package.json")));
    expect(scripts.lint).toBe("eslint . --max-warnings 0");
  });

  it("sets no rule to warn for any file lint reads", async () => {
    const linted = [];
    for (const path of repoFiles().filter((file) => /\.[jt]sx?$/u.test(file))) {
      if (!(await eslint.isPathIgnored(join(root, path)))) linted.push(path);
    }
    expect(linted).toContain("web/src/main.tsx");
    const warned = [];
    for (const path of linted) {
      for (const [rule, entry] of Object.entries(await rulesFor(path))) {
        const level = Array.isArray(entry) ? entry[0] : entry;
        if (level === 1 || level === "warn") warned.push(`${rule} in ${path}`);
      }
    }
    expect(warned).toEqual([]);
  });
});

describe("fitness: layers stay apart (types-and-lint.md)", () => {
  it("refuses an import of the service from the page", async () => {
    expect(
      await importRefused(
        'import { handler } from "../../service/src/api";\nexport { handler };\n',
        "web/src/main.tsx",
      ),
    ).toBe(true);
  });

  it("refuses an import of the page from the service", async () => {
    expect(
      await importRefused(
        'import { App } from "../../web/src/App";\nexport { App };\n',
        "service/src/index.ts",
      ),
    ).toBe(true);
  });

  it("lets the page import its own modules", async () => {
    expect(
      await importRefused(
        'import { palette } from "./palette";\nexport { palette };\n',
        "web/src/main.tsx",
      ),
    ).toBe(false);
  });

  it("lets the service use the web streams API from Node", async () => {
    expect(
      await importRefused(
        'import { ReadableStream } from "node:stream/web";\nexport { ReadableStream };\n',
        "service/src/index.ts",
      ),
    ).toBe(false);
  });
});
