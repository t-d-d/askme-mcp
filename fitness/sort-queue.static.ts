import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readRepoFile, readYaml, repoFiles } from "../test/repo";

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
        iam: z.object({
          role: z.object({ statements: z.array(statementSchema) }),
        }),
      }),
      functions: z.record(
        z.string(),
        z.looseObject({
          timeout: z.number().optional(),
          reservedConcurrency: z.unknown().optional(),
          events: z.array(z.record(z.string(), z.unknown())).optional(),
        }),
      ),
      resources: z.object({
        Resources: z.record(
          z.string(),
          z.object({
            Type: z.string(),
            Properties: z.record(z.string(), z.unknown()).optional(),
          }),
        ),
      }),
    }),
  );

const queueSchema = z.looseObject({
  FifoQueue: z.literal(true),
  VisibilityTimeout: z.number(),
  RedrivePolicy: z.unknown().optional(),
});

const sqsEventSchema = z.strictObject({
  arn: z.unknown(),
  batchSize: z.number(),
  maximumConcurrency: z.number(),
  functionResponseType: z.string(),
});

const ofType = (type: string) =>
  Object.entries(definition().resources.Resources).filter(
    ([, resource]) => resource.Type === type,
  );

const sortFunction = () => definition().functions.sort;

const actionsOf = (statement: z.infer<typeof statementSchema>) =>
  typeof statement.Action === "string" ? [statement.Action] : statement.Action;

// A test may build any client, so tests are left out.
const serviceCode = () =>
  repoFiles().filter(
    (path) =>
      path.startsWith("service/") &&
      /\.tsx?$/u.test(path) &&
      !/\.(?:static|test|int|browser|live|conformance)\.ts$/u.test(path),
  );

describe("fitness: the queue is the only way to sorting (sort-queue.md)", () => {
  it("declares one queue, a FIFO one", () => {
    const queues = ofType("AWS::SQS::Queue");
    expect(queues.map(([id]) => id)).toEqual(["SortQueue"]);
    expect(queueSchema.safeParse(queues[0]?.[1].Properties).success).toBe(true);
  });

  it("gives the sort function that queue as its only trigger", () => {
    const events = sortFunction()?.events ?? [];
    expect(events.map((event) => Object.keys(event))).toEqual([["sqs"]]);
    const trigger = sqsEventSchema.parse(events[0]?.sqs);
    expect(trigger.arn).toEqual({ "Fn::GetAtt": ["SortQueue", "Arn"] });
  });

  it("builds no Lambda client in the service, and lets the service invoke no function", () => {
    const building = serviceCode().filter((path) =>
      /@aws-sdk\/client-lambda|\bLambdaClient\b/u.test(readRepoFile(path)),
    );
    expect(building).toEqual([]);
    const invoking = definition()
      .provider.iam.role.statements.flatMap(actionsOf)
      .filter((action) => action.toLowerCase().startsWith("lambda:"));
    expect(invoking).toEqual([]);
  });

  it("finds the service's code and leaves its tests out", () => {
    const code = serviceCode();
    expect(code).toContain("service/src/jobs.ts");
    expect(code).not.toContain("service/api.int.ts");
    expect(code).not.toContain("service/src/sorter.test.ts");
  });
});

describe("fitness: one job per run, five runs at once (sort-queue.md)", () => {
  it("hands the sort function one message per run, at most five runs at once, and lets it report a failed message", () => {
    const trigger = sqsEventSchema.parse(sortFunction()?.events?.[0]?.sqs);
    expect(trigger).toMatchObject({
      batchSize: 1,
      maximumConcurrency: 5,
      functionResponseType: "ReportBatchItemFailures",
    });
  });

  it("sets no reserved concurrency on the sort function, which would trip the function-failure alarm", () => {
    expect(sortFunction()?.reservedConcurrency).toBeUndefined();
  });

  it("hides a received job for six times the sort function's timeout", () => {
    const timeout = sortFunction()?.timeout;
    expect(timeout).toBeGreaterThan(0);
    const queue = queueSchema.parse(
      ofType("AWS::SQS::Queue")[0]?.[1].Properties,
    );
    expect(queue.VisibilityTimeout).toBe(6 * (timeout ?? 0));
  });

  it("has no dead-letter queue", () => {
    const queue = queueSchema.parse(
      ofType("AWS::SQS::Queue")[0]?.[1].Properties,
    );
    expect(queue.RedrivePolicy).toBeUndefined();
  });
});

describe("fitness: only askme's role sends to the queue (sort-queue.md)", () => {
  const policySchema = z.object({
    Queues: z.array(z.unknown()),
    PolicyDocument: z.object({
      Statement: z.array(
        z.looseObject({
          Effect: z.string(),
          Principal: z.unknown(),
          Action: z.union([z.string(), z.array(z.string())]),
          Condition: z.unknown(),
        }),
      ),
    }),
  });

  it("refuses a send from any principal but the service's role", () => {
    const policies = ofType("AWS::SQS::QueuePolicy").map(([, resource]) =>
      policySchema.parse(resource.Properties),
    );
    expect(policies).toHaveLength(1);
    expect(policies[0]?.Queues).toEqual([{ Ref: "SortQueue" }]);
    expect(policies[0]?.PolicyDocument.Statement).toContainEqual(
      expect.objectContaining({
        Effect: "Deny",
        Principal: "*",
        Action: "sqs:SendMessage",
        Condition: {
          ArnNotEquals: {
            "aws:PrincipalArn": {
              "Fn::GetAtt": ["IamRoleLambdaExecution", "Arn"],
            },
          },
        },
      }),
    );
  });

  it("lets the service's role send to the queue and no other", () => {
    const sending = definition().provider.iam.role.statements.filter(
      (statement) =>
        actionsOf(statement).some((action) =>
          action.toLowerCase().startsWith("sqs:"),
        ),
    );
    expect(sending).toEqual([
      {
        Effect: "Allow",
        Action: ["sqs:SendMessage"],
        Resource: { "Fn::GetAtt": ["SortQueue", "Arn"] },
      },
    ]);
  });
});
