// Global setup for the integration tier: DynamoDB Local in Docker.
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import {
  createServer,
  request as forward,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import {
  CreateTableCommand,
  DynamoDBClient,
  ListTablesCommand,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { TestProject } from "vitest/node";
import { z } from "zod";
import { readYaml } from "./repo.ts";

declare module "vitest" {
  export interface ProvidedContext {
    databaseEndpoint: string;
    tableName: string;
  }
}

const image = "amazon/dynamodb-local:3.3.1";
const tableName = "askme";

const run = promisify(execFile);

// DynamoDB Local accepts any credentials.
export function localClient(endpoint: string): DynamoDBClient {
  return new DynamoDBClient({
    endpoint,
    region: "us-east-1",
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });
}

const dockerAnswers = () =>
  run("docker", ["info"], { timeout: 10_000 }).then(
    () => true,
    () => false,
  );

// A cloud session starts with no Docker daemon running.
async function dockerRunning(): Promise<void> {
  if (await dockerAnswers()) return;
  await new Promise<void>((resolve, reject) => {
    const daemon = spawn("dockerd", [], { detached: true, stdio: "ignore" });
    daemon.once("error", () => {
      reject(
        new Error(
          "The integration tier needs Docker for its local DynamoDB. Start Docker and run the gate again.",
        ),
      );
    });
    daemon.once("spawn", () => {
      daemon.unref();
      resolve();
    });
  });
  for (let tries = 0; tries < 60; tries += 1) {
    if (await dockerAnswers()) return;
    await sleep(500);
  }
  throw new Error("The Docker daemon did not start within 30 seconds.");
}

const tableSchema = z.object({
  resources: z.object({
    Resources: z.object({
      Table: z.object({
        Properties: z.object({
          BillingMode: z.literal("PAY_PER_REQUEST"),
          AttributeDefinitions: z.array(
            z.object({
              AttributeName: z.string(),
              AttributeType: z.enum(["S", "N", "B"]),
            }),
          ),
          KeySchema: z.array(
            z.object({
              AttributeName: z.string(),
              KeyType: z.enum(["HASH", "RANGE"]),
            }),
          ),
        }),
      }),
    }),
  }),
});

async function ready(client: DynamoDBClient): Promise<void> {
  let failure: unknown;
  for (let tries = 0; tries < 60; tries += 1) {
    try {
      await client.send(new ListTablesCommand({}));
      return;
    } catch (error) {
      failure = error;
      await sleep(250);
    }
  }
  throw new Error("The local DynamoDB did not answer.", { cause: failure });
}

// cat waits on stdin, which this run holds open through the docker client
// it starts. However the run ends, the stream closes, the shell exits and
// the container is removed. This ties the container to the run and not to a
// process id or hostname, which another run on the daemon may share.
const untilRunEnds =
  "java -jar DynamoDBLocal.jar -inMemory -sharedDb & cat > /dev/null";

async function startDatabase(): Promise<string> {
  // Made as a step of its own, so the image is pulled before anything waits
  // for the container to start.
  const { stdout } = await run("docker", [
    "create",
    "--interactive",
    "--rm",
    "--publish",
    "127.0.0.1::8000",
    "--entrypoint",
    "sh",
    image,
    "-c",
    untilRunEnds,
  ]);
  const container = stdout.trim();
  // The client attaches before it starts the container, so the container
  // never runs without its stdin held. It writes only if the start fails.
  spawn("docker", ["start", "--attach", "--interactive", container], {
    stdio: ["pipe", "ignore", "inherit"],
  });
  return container;
}

async function publishedEndpoint(container: string): Promise<string> {
  for (let tries = 0; tries < 60; tries += 1) {
    const port = await run("docker", ["port", container, "8000/tcp"]).then(
      ({ stdout }) => /:(\d+)\s*$/mu.exec(stdout.split("\n")[0] ?? "")?.[1],
      () => undefined,
    );
    if (port !== undefined) return `http://127.0.0.1:${port}`;
    await sleep(250);
  }
  throw new Error("The local DynamoDB has no port.");
}

export default async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  await dockerRunning();
  const container = await startDatabase();
  const stop = async () => {
    await run("docker", ["rm", "--force", container]);
  };
  try {
    const endpoint = await publishedEndpoint(container);
    const client = localClient(endpoint);
    await ready(client);
    const { Properties: table } = readYaml("serverless.yml", tableSchema)
      .resources.Resources.Table;
    await client.send(
      new CreateTableCommand({ TableName: tableName, ...table }),
    );
    client.destroy();
    project.provide("databaseEndpoint", endpoint);
    project.provide("tableName", tableName);
  } catch (error) {
    await stop();
    throw error;
  }
  return stop;
}

export async function storedItems(
  endpoint: string,
  table: string,
  account: string,
): Promise<Record<string, unknown>[]> {
  const db = DynamoDBDocumentClient.from(localClient(endpoint));
  try {
    const { Items } = await db.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "pk = :account",
        ExpressionAttributeValues: { ":account": account },
        ConsistentRead: true,
      }),
    );
    return Items ?? [];
  } finally {
    db.destroy();
  }
}

export async function putItem(
  endpoint: string,
  table: string,
  item: Record<string, unknown>,
): Promise<void> {
  const db = DynamoDBDocumentClient.from(localClient(endpoint));
  try {
    await db.send(new PutCommand({ TableName: table, Item: item }));
  } finally {
    db.destroy();
  }
}

export interface DatabaseCall {
  action: string;
  sortKeys: string[];
}

export interface DatabaseRecorder {
  endpoint: string;
  calls: DatabaseCall[];
  // Cancels the next `times` transactions as conflicts. DynamoDB Local runs
  // one transaction at a time, so it never cancels one itself. A cancelled
  // transaction is recorded but never reaches it.
  conflict(times: number, options?: Conflict): void;
  close(): Promise<void>;
}

// meanwhile runs before the answer, as the transaction that held the item
// would finish. conditionFailed also names a failed condition on the first
// item, as DynamoDB does when it finds both at once.
export interface Conflict {
  meanwhile?: () => Promise<unknown>;
  conditionFailed?: boolean;
}

export const readActions = new Set([
  "GetItem",
  "BatchGetItem",
  "Query",
  "Scan",
  "TransactGetItems",
]);

function sortKeysIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(sortKeysIn);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([name, inner]) => {
    if (name === "sk" && typeof inner === "object" && inner !== null) {
      const text: unknown = Reflect.get(inner, "S");
      if (typeof text === "string") return [text];
    }
    return sortKeysIn(inner);
  });
}

const transactionSchema = z.object({ TransactItems: z.array(z.unknown()) });

// A 400, which the SDK does not retry.
function refuse(outgoing: ServerResponse, body: object): void {
  outgoing.writeHead(400, { "content-type": "application/x-amz-json-1.0" });
  outgoing.end(JSON.stringify(body));
}

// DynamoDB gives a reason for each item, in order. Which item was held makes
// no difference to the store, so the last is named. A one-item transaction
// with conditionFailed names only the failed condition.
function cancelled(
  outgoing: ServerResponse,
  request: unknown,
  conditionFailed: boolean,
): void {
  const parsed = transactionSchema.safeParse(request);
  const items = parsed.success ? parsed.data.TransactItems.length : 1;
  const reasons = Array.from({ length: items }, (_, index) => {
    if (index === 0 && conditionFailed) {
      return {
        Code: "ConditionalCheckFailed",
        Message: "The conditional request failed",
      };
    }
    return index === items - 1
      ? {
          Code: "TransactionConflict",
          Message: "Transaction is ongoing for the item",
        }
      : { Code: "None" };
  });
  const codes = reasons.map((reason) => reason.Code).join(", ");
  refuse(outgoing, {
    __type: "com.amazonaws.dynamodb.v20120810#TransactionCanceledException",
    Message: `Transaction cancelled, please refer cancellation reasons for specific reasons [${codes}]`,
    CancellationReasons: reasons,
  });
}

function meanwhileFailed(outgoing: ServerResponse): void {
  refuse(outgoing, {
    __type: "com.amazon.coral.validate#ValidationException",
    Message: "The test's meanwhile step failed.",
  });
}

// A loopback proxy to DynamoDB Local that records each call.
export async function recordDatabase(
  endpoint: string,
): Promise<DatabaseRecorder> {
  const target = new URL(endpoint);
  const calls: DatabaseCall[] = [];
  const conflicts: { left: number; options: Conflict } = {
    left: 0,
    options: {},
  };
  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      const body = Buffer.concat(chunks);
      const action = String(incoming.headers["x-amz-target"] ?? "")
        .split(".")
        .at(-1);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body.toString("utf8"));
      } catch {
        parsed = undefined;
      }
      calls.push({ action: action ?? "", sortKeys: sortKeysIn(parsed) });
      if (action === "TransactWriteItems" && conflicts.left > 0) {
        conflicts.left -= 1;
        // A failed meanwhile gets an error the SDK does not retry, so the
        // test sees it. A dropped connection would be resent and go through.
        const { meanwhile, conditionFailed = false } = conflicts.options;
        void Promise.resolve()
          .then(meanwhile)
          .then(
            () => {
              cancelled(outgoing, parsed, conditionFailed);
            },
            () => {
              meanwhileFailed(outgoing);
            },
          );
        return;
      }
      const upstream = forward(
        new URL(incoming.url ?? "/", target),
        {
          method: incoming.method,
          headers: { ...incoming.headers, host: target.host },
        },
        (reply) => {
          outgoing.writeHead(reply.statusCode ?? 502, reply.headers);
          reply.pipe(outgoing);
        },
      );
      upstream.on("error", () => outgoing.destroy());
      upstream.end(body);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = z
    .object({ port: z.number() })
    .parse(server.address() satisfies AddressInfo | string | null);
  return {
    endpoint: `http://127.0.0.1:${String(port)}`,
    calls,
    conflict: (times, options = {}) => {
      conflicts.left = times;
      conflicts.options = options;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
