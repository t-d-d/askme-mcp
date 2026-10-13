import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { AccountId } from "../service/src/identity";
import { keys, sortKeys } from "../service/src/store/keys";
import { importRefused, reported } from "../test/lint";
import { readRepoFile, readYaml, repoFiles } from "../test/repo";

const tableSchema = z.object({
  Type: z.literal("AWS::DynamoDB::Table"),
  Properties: z.looseObject({
    BillingMode: z.string(),
    AttributeDefinitions: z.array(
      z.object({ AttributeName: z.string(), AttributeType: z.string() }),
    ),
    KeySchema: z.array(
      z.object({ AttributeName: z.string(), KeyType: z.string() }),
    ),
    GlobalSecondaryIndexes: z.unknown().optional(),
    LocalSecondaryIndexes: z.unknown().optional(),
  }),
});

const statementSchema = z.object({
  Effect: z.string(),
  Action: z.union([z.string(), z.array(z.string())]),
  Resource: z.unknown(),
});

const definition = () =>
  readYaml(
    "serverless.yml",
    z.object({
      provider: z.object({
        iam: z
          .object({
            role: z.object({ statements: z.array(statementSchema) }),
          })
          .optional(),
      }),
      resources: z.object({
        Resources: z.record(
          z.string(),
          z.looseObject({ Type: z.string(), Properties: z.unknown() }),
        ),
      }),
    }),
  );

const tables = () =>
  Object.values(definition().resources.Resources)
    .filter((resource) => resource.Type === "AWS::DynamoDB::Table")
    .map((resource) => tableSchema.parse(resource));

// The key module, the one place a key is written.
const keysPath = "service/src/store/keys.ts";

// A file of service code that is neither the key module nor the store.
const servicePath = "service/src/ask.ts";

describe("fitness: no index, no scan (table-design.md)", () => {
  // The first type-aware lint of a file loads its project, which takes longer
  // than one test may.
  beforeAll(async () => {
    await reported("", servicePath);
  }, 60_000);

  it("declares one table, with no secondary index", () => {
    expect(tables()).toHaveLength(1);
    const [table] = tables();
    expect(table?.Properties.GlobalSecondaryIndexes).toBeUndefined();
    expect(table?.Properties.LocalSecondaryIndexes).toBeUndefined();
  });

  it("keys the table by account, then by what the item is", () => {
    const [table] = tables();
    expect(table?.Properties.KeySchema).toEqual([
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" },
    ]);
  });

  it.each([
    'import { ScanCommand } from "./store/store";\nexport const s = new ScanCommand();\n',
    "export const s = (db: { scan(): void }) => {\n  db.scan();\n};\n",
    'import { paginateScan } from "./store/store";\nexport { paginateScan };\n',
  ])("refuses a scan in code: %s", async (code) => {
    expect(await reported(code, servicePath)).toContain("askme/no-scan");
  });

  // Every action is named in full, so none can stand for a scan, and no
  // DynamoDB action is one. Actions on other services, such as reading the
  // model's key, cannot touch the table.
  it("gives the service no right to scan", () => {
    const actions = (definition().provider.iam?.role.statements ?? [])
      .filter((statement) => statement.Effect === "Allow")
      .flatMap((statement) => [statement.Action].flat());
    const table = actions.filter((action) => action.startsWith("dynamodb:"));
    expect(table.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action).toMatch(/^[a-z0-9-]+:[A-Za-z]+$/u);
      expect(action).not.toMatch(/scan/iu);
    }
  });
});

describe("fitness: one key builder (table-design.md)", () => {
  beforeAll(async () => {
    await reported("", servicePath);
  }, 60_000);

  it.each([
    'export const k = { sk: "META" };\n',
    'export const k = { sk: "RULES" };\n',
    'export const k = (id: string) => ({ sk: "OPEN#" + id });\n',
    "export const k = (id: string) => ({ sk: `CLOSED#${id}` });\n",
    'export const k = { sk: "DEDUPE#abc" };\n',
    "export const k = (day: string) => ({ sk: `USAGE#${day}` });\n",
    "export const k = (w: string) => ({ sk: `POLL#${w}` });\n",
    "export const k = (w: string) => ({ sk: `RATE#${w}` });\n",
    "export const k = (w: string) => ({ sk: `SAVE#${w}` });\n",
  ])("refuses a key written by hand: %s", async (code) => {
    expect(await reported(code, servicePath)).toContain(
      "askme/no-hand-built-key",
    );
  });

  it("lets the key module write keys", async () => {
    expect(
      await reported('export const k = { sk: "META" };\n', keysPath),
    ).not.toContain("askme/no-hand-built-key");
  });

  it.each([
    "@aws-sdk/client-dynamodb",
    "@aws-sdk/lib-dynamodb",
    "@aws-sdk/util-dynamodb",
  ])("refuses the database client, %s, outside the store", async (name) => {
    for (const path of [
      servicePath,
      "service/src/handler.ts",
      "web/src/App.tsx",
    ]) {
      expect(
        await importRefused(
          `import * as db from "${name}";\nexport { db };\n`,
          path,
        ),
        path,
      ).toBe(true);
    }
  });

  it("lets the store module import the database client", async () => {
    expect(
      await importRefused(
        'import { DynamoDBClient } from "@aws-sdk/client-dynamodb";\nexport { DynamoDBClient };\n',
        "service/src/store/store.ts",
      ),
    ).toBe(false);
  });
});

// The sort keys and prefixes a key module builds: every string in it, whole
// or as the start of a template, apart from the paths it imports. The module
// builds keys and nothing else, so each of its strings is part of one. It
// is read as TypeScript, so its comments are left out.
const builtKeys = (text: string): string[] => {
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isStringLiteralLike(node)) found.add(node.text);
    if (ts.isTemplateExpression(node)) found.add(node.head.text);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(keysPath, text, ts.ScriptTarget.Latest, true));
  return [...found].filter((value) => value !== "");
};

// The "Sort keys" rule in table-design.md, its lines joined.
const sortKeysRule = (): string => {
  const text = readRepoFile("docs/constraints/table-design.md").replaceAll(
    "\n  ",
    " ",
  );
  const rule = /^- Sort keys: (.+)$/mu.exec(text)?.[1];
  expect(rule, 'the "Sort keys" rule in table-design.md').toBeDefined();
  return rule ?? "";
};

// Whether a rule names a key: a prefix with what follows it in angle
// brackets, as OPEN#<id>, and a whole key as a word of its own, as META.
const names = (rule: string, key: string): boolean => {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const end = key.endsWith("#") ? "<" : "(?![\\w#<])";
  return new RegExp(`(?<![\\w#])${escaped}${end}`, "u").test(rule);
};

// The keys a key module builds that the "Sort keys" rule does not name.
const unnamed = (text: string): string[] => {
  const rule = sortKeysRule();
  return builtKeys(text).filter((key) => !names(rule, key));
};

describe("fitness: the sort keys rule names every key the key module builds (table-design.md)", () => {
  it("names every sort key and prefix the key module builds", () => {
    expect(unnamed(readRepoFile(keysPath))).toEqual([]);
  });

  it.each([
    ['const otherPrefix = "OTHER#";\n', "OTHER#"],
    ["export const other = (id: string) => `OTHER#${id}`;\n", "OTHER#"],
    ['export const other = { sk: "OTHER" };\n', "OTHER"],
    ['export const other = { sk: "settings" };\n', "settings"],
    ['export const other = { sk: "RULE" };\n', "RULE"],
    ['export const other = { sk: "OPEN" };\n', "OPEN"],
  ])("finds a key the rule does not name: %s", (code, key) => {
    expect(unnamed(`${readRepoFile(keysPath)}${code}`)).toEqual([key]);
  });
});

// The keys a key module builds that are not in the list it exports, which is
// the list askme/no-hand-built-key reads.
const unlisted = (text: string): string[] => {
  const listed = new Set<string>(Object.values(sortKeys));
  return builtKeys(text).filter((key) => !listed.has(key));
};

describe("fitness: the key module builds every key from the list lint reads (table-design.md)", () => {
  it("lists every sort key and prefix the key module builds", () => {
    expect(unlisted(readRepoFile(keysPath))).toEqual([]);
  });

  it.each([
    ['const otherPrefix = "OTHER#";\n', "OTHER#"],
    ["export const other = (id: string) => `OTHER#${id}`;\n", "OTHER#"],
    ['export const other = { sk: "OTHER" };\n', "OTHER"],
  ])("finds a key the list leaves out: %s", (code, key) => {
    expect(unlisted(`${readRepoFile(keysPath)}${code}`)).toEqual([key]);
  });
});

describe("fitness: two functions write (table-design.md)", () => {
  const storePath = "service/src/store/store.ts";

  // What lint reports for the store module as it stands. Linting the whole
  // module takes longer than one test may when the gate keeps the machine
  // busy, so it runs once here, and loads the project for the tests below.
  let storeReported: string[];

  beforeAll(async () => {
    storeReported = await reported(readRepoFile(storePath), storePath);
  }, 60_000);

  it.each([
    [
      "PutCommand",
      "export const f = () => new PutCommand({ TableName: 't', Item: {} });\n",
    ],
    [
      "UpdateCommand",
      "export async function postAsk() {\n  return new UpdateCommand({ TableName: 't', Key: {} });\n}\n",
    ],
    [
      "DeleteCommand",
      "export const store = {\n  close() {\n    return new DeleteCommand({ TableName: 't', Key: {} });\n  },\n};\n",
    ],
    [
      "TransactWriteCommand",
      "export function writeAll() {\n  return new TransactWriteCommand({ TransactItems: [] });\n}\n",
    ],
    [
      "BatchWriteCommand",
      "export const f = () => new BatchWriteCommand({ RequestItems: {} });\n",
    ],
    [
      "UpdateItemCommand",
      "export const f = () => new UpdateItemCommand({ TableName: 't', Key: {} });\n",
    ],
  ])("refuses %s outside write() and count()", async (name, body) => {
    const code = `import { ${name} } from "@aws-sdk/lib-dynamodb";\n${body}`;
    expect(await reported(code, storePath)).toContain("askme/write-functions");
  });

  it.each([
    "import { PutCommand as Store } from \"@aws-sdk/lib-dynamodb\";\nexport const f = () => new Store({ TableName: 't', Item: {} });\n",
    "import * as lib from \"@aws-sdk/lib-dynamodb\";\nexport const f = () => new lib.PutCommand({ TableName: 't', Item: {} });\n",
  ])("refuses a write command under another name: %s", async (code) => {
    expect(await reported(code, storePath)).toContain("askme/write-functions");
  });

  it.each([
    "export async function write() {\n  return new TransactWriteCommand({ TransactItems: [] });\n}\n",
    "export const write = async () => new TransactWriteCommand({ TransactItems: [] });\n",
    "export async function count() {\n  return new UpdateCommand({ TableName: 't', Key: {} });\n}\n",
    "export function write() {\n  return [1].map(() => new TransactWriteCommand({ TransactItems: [] }));\n}\n",
  ])("lets write() and count() build a write command: %s", async (body) => {
    const code = `import { TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";\n${body}`;
    expect(await reported(code, storePath)).not.toContain(
      "askme/write-functions",
    );
  });

  it("finds the store's own writes in those two functions", () => {
    expect(storeReported).not.toContain("askme/write-functions");
  });
});

describe("fitness: the account comes from the token (table-design.md)", () => {
  it("brands an account id in the identity module and nowhere else", () => {
    const branding = repoFiles()
      .filter((path) => /\.tsx?$/u.test(path))
      .filter((path) => !path.startsWith("fitness/"))
      .filter((path) => /\.brand\s*</u.test(readRepoFile(path)));
    expect(branding).toEqual(["service/src/identity.ts"]);
  });

  it("builds a key only from an account id the token check made", () => {
    const fromCaller = (account: AccountId) => keys.meta(account);
    expect(typeof fromCaller).toBe("function");
    // @ts-expect-error -- a plain string is not an account id
    expect(keys.meta("user_someone").pk).toBe("user_someone");
  });
});
