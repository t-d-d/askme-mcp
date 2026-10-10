import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  readWorkflow,
  readYaml,
  resourceSchema,
  templateSchema,
} from "../test/repo";

const definitionSchema = z.object({
  service: z.string(),
  provider: z.object({ name: z.literal("aws"), stage: z.string() }),
  functions: z
    .record(
      z.string(),
      z.object({
        events: z.array(z.record(z.string(), z.unknown())).optional(),
        provisionedConcurrency: z.unknown().optional(),
        url: z.unknown().optional(),
      }),
    )
    .optional(),
  resources: z.object({ Resources: z.record(z.string(), resourceSchema) }),
});

const definition = () => readYaml("serverless.yml", definitionSchema);

const behaviourSchema = z.object({
  TargetOriginId: z.string(),
  LambdaFunctionAssociations: z.unknown().optional(),
  FunctionAssociations: z.unknown().optional(),
});

const distributionSchema = z.object({
  DistributionConfig: z.object({
    Origins: z.array(z.object({ Id: z.string(), DomainName: z.unknown() })),
    DefaultCacheBehavior: behaviourSchema,
    CacheBehaviors: z.array(behaviourSchema).optional(),
  }),
});

describe("fitness: the page is static (hosting.md)", () => {
  it("serves the page from the bucket, with no code in front of it", () => {
    const resources = Object.entries(definition().resources.Resources);
    const distributions = resources.filter(
      ([, resource]) => resource.Type === "AWS::CloudFront::Distribution",
    );
    expect(distributions).toHaveLength(1);
    const { DistributionConfig: config } = distributionSchema.parse(
      distributions[0]?.[1].Properties,
    );
    const origin = config.Origins.find(
      (candidate) =>
        candidate.Id === config.DefaultCacheBehavior.TargetOriginId,
    );
    const buckets = resources
      .filter(([, resource]) => resource.Type === "AWS::S3::Bucket")
      .map(([id]) => ({ "Fn::GetAtt": [id, "RegionalDomainName"] }));
    expect(buckets).toContainEqual(origin?.DomainName);
    for (const behaviour of [
      config.DefaultCacheBehavior,
      ...(config.CacheBehaviors ?? []),
    ]) {
      expect(behaviour.LambdaFunctionAssociations).toBeUndefined();
      expect(behaviour.FunctionAssociations).toBeUndefined();
    }
  });

  it("declares no function that serves the page's address", () => {
    const servingRoot = Object.entries(definition().functions ?? {})
      .filter(([, fn]) =>
        (fn.events ?? []).some((event) =>
          /"path":"\/(?:\{proxy\+\})?"|"\*"/u.test(JSON.stringify(event)),
        ),
      )
      .map(([name]) => name);
    expect(servingRoot).toEqual([]);
  });
});

describe("fitness: nothing runs continuously (hosting.md)", () => {
  // Each type here costs nothing while idle. A new type is added on purpose,
  // after checking that it scales to zero.
  const onDemand = new Set([
    "AWS::CloudFront::Distribution",
    "AWS::CloudFront::OriginAccessControl",
    "AWS::IAM::OIDCProvider",
    "AWS::IAM::Role",
    "AWS::S3::Bucket",
    "AWS::S3::BucketPolicy",
  ]);

  it("declares only resources that cost nothing while idle", () => {
    const declared = [
      ...Object.entries(definition().resources.Resources),
      ...Object.entries(
        readYaml("infra/github-oidc.cfn.yml", templateSchema).Resources,
      ),
    ];
    const standing = declared
      .filter(([, resource]) => !onDemand.has(resource.Type))
      .map(([id, resource]) => `${id}: ${resource.Type}`);
    expect(standing).toEqual([]);
  });

  it("gives no function a live connection or reserved capacity", () => {
    const live = Object.entries(definition().functions ?? {})
      .filter(
        ([, fn]) =>
          fn.provisionedConcurrency !== undefined ||
          JSON.stringify(fn.url ?? {}).includes("RESPONSE_STREAM") ||
          (fn.events ?? []).some((event) => "websocket" in event),
      )
      .map(([name]) => name);
    expect(live).toEqual([]);
  });
});

describe("fitness: the deploy role is assumed (hosting.md)", () => {
  const deployJob = () =>
    readWorkflow(".github/workflows/deploy.yml").jobs.deploy;

  it("asks GitHub for a short-lived token", () => {
    expect(deployJob()?.permissions).toEqual({
      contents: "read",
      "id-token": "write",
    });
  });

  it("assumes the role named in the repo variables, with no key", () => {
    const credentials = (deployJob()?.steps ?? []).filter((step) =>
      step.uses?.startsWith("aws-actions/configure-aws-credentials@"),
    );
    expect(credentials).toHaveLength(1);
    expect(credentials[0]?.with).toEqual({
      "role-to-assume": "${{ vars.AWS_DEPLOY_ROLE_ARN }}",
      "aws-region": "${{ vars.AWS_REGION }}",
    });
  });
});
