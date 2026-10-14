import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readYaml } from "../test/repo";

// Each account's rules and META item never expire, so the table outlives the
// stack and a replacement, and can be restored to a point in time.
const tableSchema = z.looseObject({
  Type: z.literal("AWS::DynamoDB::Table"),
  DeletionPolicy: z.unknown().optional(),
  UpdateReplacePolicy: z.unknown().optional(),
  Properties: z.looseObject({
    DeletionProtectionEnabled: z.unknown().optional(),
    PointInTimeRecoverySpecification: z
      .looseObject({ PointInTimeRecoveryEnabled: z.unknown().optional() })
      .optional(),
  }),
});

type Table = z.infer<typeof tableSchema>;

// The safeguards a table lacks, by name.
const unkept = (table: Table): string[] =>
  [
    table.DeletionPolicy === "Retain" ? undefined : "DeletionPolicy",
    table.UpdateReplacePolicy === "Retain" ? undefined : "UpdateReplacePolicy",
    table.Properties.DeletionProtectionEnabled === true
      ? undefined
      : "DeletionProtectionEnabled",
    table.Properties.PointInTimeRecoverySpecification
      ?.PointInTimeRecoveryEnabled === true
      ? undefined
      : "PointInTimeRecoverySpecification",
  ].filter((name) => name !== undefined);

const tables = (): Table[] =>
  Object.values(
    readYaml(
      "serverless.yml",
      z.object({
        resources: z.object({
          Resources: z.record(z.string(), z.looseObject({ Type: z.string() })),
        }),
      }),
    ).resources.Resources,
  )
    .filter((resource) => resource.Type === "AWS::DynamoDB::Table")
    .map((resource) => tableSchema.parse(resource));

const kept: Table = {
  Type: "AWS::DynamoDB::Table",
  DeletionPolicy: "Retain",
  UpdateReplacePolicy: "Retain",
  Properties: {
    DeletionProtectionEnabled: true,
    PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
  },
};

describe("the table is kept", () => {
  it("keeps the table through a stack change, and can restore it", () => {
    const declared = tables();
    expect(declared.length).toBeGreaterThan(0);
    for (const table of declared) expect(unkept(table)).toEqual([]);
  });

  it("finds nothing missing from a kept table", () => {
    expect(unkept(kept)).toEqual([]);
  });

  it.each([
    ["DeletionPolicy", { ...kept, DeletionPolicy: undefined }],
    ["DeletionPolicy", { ...kept, DeletionPolicy: "Delete" }],
    ["UpdateReplacePolicy", { ...kept, UpdateReplacePolicy: undefined }],
    ["UpdateReplacePolicy", { ...kept, UpdateReplacePolicy: "Snapshot" }],
    [
      "DeletionProtectionEnabled",
      {
        ...kept,
        Properties: { ...kept.Properties, DeletionProtectionEnabled: false },
      },
    ],
    [
      "PointInTimeRecoverySpecification",
      {
        ...kept,
        Properties: { DeletionProtectionEnabled: true },
      },
    ],
    [
      "PointInTimeRecoverySpecification",
      {
        ...kept,
        Properties: {
          DeletionProtectionEnabled: true,
          PointInTimeRecoverySpecification: {
            PointInTimeRecoveryEnabled: false,
          },
        },
      },
    ],
  ])("finds %s missing", (name, table: Table) => {
    expect(unkept(table)).toEqual([name]);
  });
});
