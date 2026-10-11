import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { AccountId } from "../service/src/identity";
import { keys } from "../service/src/store/keys";
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

  it("gives the service no right to scan", () => {
    const actions = (definition().provider.iam?.role.statements ?? [])
      .filter((statement) => statement.Effect === "Allow")
      .flatMap((statement) => [statement.Action].flat());
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action).toMatch(/^dynamodb:[A-Za-z]+$/u);
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
    'export const k = (id: string) => ({ sk: "OPEN#" + id });\n',
    "export const k = (id: string) => ({ sk: `CLOSED#${id}` });\n",
    'export const k = { sk: "DEDUPE#abc" };\n',
    "export const k = (day: string) => ({ sk: `USAGE#${day}` });\n",
    "export const k = (minute: string) => ({ sk: `RATE#${minute}` });\n",
  ])("refuses a key written by hand: %s", async (code) => {
    expect(await reported(code, servicePath)).toContain(
      "askme/no-hand-built-key",
    );
  });

  it("lets the key module write keys", async () => {
    expect(
      await reported(
        'export const k = { sk: "META" };\n',
        "service/src/store/keys.ts",
      ),
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
