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

// The paths at which the page itself would be served.
const pagePaths = new Set(["/", "/{proxy+}", "*"]);

// The paths an HTTP event answers, written as "GET /" or as { path: "/" }.
function eventPaths(event: Record<string, unknown>): string[] {
  return Object.values(event).flatMap((value) => {
    if (typeof value === "string") return [value.split(" ").at(-1) ?? value];
    if (typeof value === "object" && value !== null && "path" in value) {
      return typeof value.path === "string" ? [value.path] : [];
    }
    return [];
  });
}

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
          eventPaths(event).some((path) => pagePaths.has(path)),
        ),
      )
      .map(([name]) => name);
    expect(servingRoot).toEqual([]);
  });

  it("reads an event's path in either form", () => {
    expect(eventPaths({ httpApi: "GET /" })).toEqual(["/"]);
    expect(eventPaths({ httpApi: "*" })).toEqual(["*"]);
    expect(eventPaths({ http: { method: "get", path: "/{proxy+}" } })).toEqual([
      "/{proxy+}",
    ]);
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
    "AWS::Logs::MetricFilter",
    "AWS::Logs::QueryDefinition",
    "AWS::S3::Bucket",
    "AWS::S3::BucketPolicy",
    "AWS::SNS::Subscription",
    "AWS::SNS::Topic",
    // The sort queue is billed per request, but Lambda polls it for the
    // sort function's trigger even while it is empty, and those requests
    // are billed too. They are the one idle cost hosting.md allows. Its
    // policy costs nothing.
    "AWS::SQS::Queue",
    "AWS::SQS::QueuePolicy",
  ]);

  // An alarm is billed by the month, for each metric it reads, past
  // CloudWatch's free ten. ADR 8 chose alarms knowing that, so they pass
  // here while all of them together read ten metrics or fewer. Each new
  // function adds two to the function-failures alarm.
  const alarm = (resource: z.infer<typeof resourceSchema>) =>
    resource.Type === "AWS::CloudWatch::Alarm";
  const freeAlarmMetrics = 10;
  const metricsRead = (resource: z.infer<typeof resourceSchema>): number => {
    const metrics = z
      .array(z.looseObject({ MetricStat: z.unknown().optional() }))
      .optional()
      .parse(resource.Properties?.Metrics);
    return metrics === undefined
      ? 1
      : metrics.filter((entry) => entry.MetricStat !== undefined).length;
  };

  // A table costs nothing while idle only when it is billed per request.
  const onDemandTable = (resource: z.infer<typeof resourceSchema>) =>
    resource.Type === "AWS::DynamoDB::Table" &&
    resource.Properties?.BillingMode === "PAY_PER_REQUEST";

  it("declares only resources that cost nothing while idle", () => {
    const declared = [
      ...Object.entries(definition().resources.Resources),
      ...Object.entries(
        readYaml("infra/github-oidc.cfn.yml", templateSchema).Resources,
      ),
    ];
    const standing = declared
      .filter(
        ([, resource]) =>
          !onDemand.has(resource.Type) &&
          !onDemandTable(resource) &&
          !alarm(resource),
      )
      .map(([id, resource]) => `${id}: ${resource.Type}`);
    expect(standing).toEqual([]);
  });

  it("keeps the alarms within CloudWatch's free metrics", () => {
    const read = Object.values(definition().resources.Resources)
      .filter(alarm)
      .reduce((sum, resource) => sum + metricsRead(resource), 0);
    expect(read).toBeLessThanOrEqual(freeAlarmMetrics);
  });

  it("counts the metrics an alarm reads, alone or by math", () => {
    expect(
      metricsRead({
        Type: "AWS::CloudWatch::Alarm",
        Properties: { Namespace: "askme", MetricName: "ErrorLines" },
      }),
    ).toBe(1);
    expect(
      metricsRead({
        Type: "AWS::CloudWatch::Alarm",
        Properties: {
          Metrics: [
            { Id: "a", MetricStat: {} },
            { Id: "b", MetricStat: {} },
            { Id: "sum", Expression: "SUM(METRICS())" },
          ],
        },
      }),
    ).toBe(2);
  });

  it("tells a table billed per request from one with set capacity", () => {
    expect(
      onDemandTable({
        Type: "AWS::DynamoDB::Table",
        Properties: { BillingMode: "PAY_PER_REQUEST" },
      }),
    ).toBe(true);
    expect(
      onDemandTable({
        Type: "AWS::DynamoDB::Table",
        Properties: { BillingMode: "PROVISIONED" },
      }),
    ).toBe(false);
    expect(onDemandTable({ Type: "AWS::DynamoDB::Table" })).toBe(false);
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
