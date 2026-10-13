// Global setup for the integration tier: a real DynamoDB, run locally in
// Docker (ADR 9), with the table made from the deployment definition, so the
// atomic write and late expiry are the real store's. It listens on loopback
// only, so the offline guard lets tests reach it.
//
// Where the Docker daemon is not running, as in a Claude cloud session, it is
// started first.
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import {
  createServer,
  request as forward,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { hostname } from "node:os";
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
import { readYaml } from "./repo";

declare module "vitest" {
  export interface ProvidedContext {
    databaseEndpoint: string;
    tableName: string;
  }
}

const image = "amazon/dynamodb-local:3.3.1";
const tableName = "askme";

const run = promisify(execFile);

// A client for the local database. DynamoDB Local accepts any credentials.
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

// The run a container belongs to: the process that started it, and the
// machine that process runs on.
export interface Owner {
  pid: number;
  host: string;
}

const label = "askme-mcp.dynamodb";

// Starts a local DynamoDB, labelled with the run it belongs to, and gives
// the container's id.
export async function startDatabase(owner: Owner): Promise<string> {
  const { stdout } = await run("docker", [
    "run",
    "--detach",
    "--rm",
    "--label",
    `${label}.pid=${String(owner.pid)}`,
    "--label",
    `${label}.host=${owner.host}`,
    "--publish",
    "127.0.0.1::8000",
    image,
    "-jar",
    "DynamoDBLocal.jar",
    "-inMemory",
    "-sharedDb",
  ]);
  return stdout.trim();
}

// Whether a process on this machine is still running. A process that runs
// as another user still exists, though it cannot be signalled.
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && Reflect.get(error, "code") === "EPERM";
  }
}

// Removes every local DynamoDB whose run has ended without stopping it, as a
// run killed before its teardown does. Only this machine's containers are
// judged, as only its process ids can be checked.
export async function removeOrphans(): Promise<void> {
  const { stdout } = await run("docker", [
    "ps",
    "--all",
    "--no-trunc",
    "--filter",
    `label=${label}.host=${hostname()}`,
    "--format",
    `{{.ID}} {{.Label "${label}.pid"}}`,
  ]);
  const orphans = [...stdout.matchAll(/^(\w+) (\d+)$/gmu)]
    .filter(([, , pid]) => !alive(Number(pid)))
    .map(([, id]) => id ?? "");
  if (orphans.length > 0) await run("docker", ["rm", "--force", ...orphans]);
}

export default async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  await dockerRunning();
  await removeOrphans();
  const container = await startDatabase({
    pid: process.pid,
    host: hostname(),
  });
  const stop = async () => {
    await run("docker", ["rm", "--force", container]);
  };
  try {
    const { stdout: published } = await run("docker", [
      "port",
      container,
      "8000/tcp",
    ]);
    const port = /:(\d+)\s*$/mu.exec(published.split("\n")[0] ?? "")?.[1];
    if (port === undefined) throw new Error("The local DynamoDB has no port.");
    const endpoint = `http://127.0.0.1:${port}`;
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

// Every item stored under an account, read straight from the table, so a
// test can see what is stored whatever the service would return.
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

// Puts an item straight into the table, as a test's setup, such as a rate
// counter already near its limit, which the store would take thousands of
// calls to reach.
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

// One call the service made to the database: the action, such as GetItem,
// and the sort key of every item it names.
export interface DatabaseCall {
  action: string;
  sortKeys: string[];
}

export interface DatabaseRecorder {
  // The address to give the service in place of the database's.
  endpoint: string;
  calls: DatabaseCall[];
  // Cancels the next transactions, as many as given, as real DynamoDB does
  // when another transaction holds one of their items. The local DynamoDB
  // runs one transaction at a time, so it never does this itself. A
  // cancelled transaction is recorded, but never reaches it.
  conflict(times: number, options?: Conflict): void;
  close(): Promise<void>;
}

// How the recorder cancels a transaction. Before it answers, meanwhile
// runs, as the transaction that held the item would finish. With
// conditionFailed, the answer also names a failed condition on the first
// item, as when DynamoDB finds both at once.
export interface Conflict {
  meanwhile?: () => Promise<unknown>;
  conditionFailed?: boolean;
}

// The actions that read the table.
export const readActions = new Set([
  "GetItem",
  "BatchGetItem",
  "Query",
  "Scan",
  "TransactGetItems",
]);

// Every sort key written as {"sk": {"S": "..."}} anywhere in a request.
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

// An error DynamoDB gives, which the SDK does not send again.
function refuse(outgoing: ServerResponse, body: object): void {
  outgoing.writeHead(400, { "content-type": "application/x-amz-json-1.0" });
  outgoing.end(JSON.stringify(body));
}

// DynamoDB's answer to a transaction that met another one on an item: it is
// cancelled whole, with a reason for each of its items, in order. Which item
// was held makes no difference to the store, so the last one is named, and
// a failed condition, when asked for, is named on the first. A transaction
// of one item then names only the failed condition, which is the answer the
// store acts on.
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

// The answer when the test's own meanwhile step failed: an error DynamoDB
// gives for a bad request, which the SDK never retries.
function meanwhileFailed(outgoing: ServerResponse): void {
  refuse(outgoing, {
    __type: "com.amazon.coral.validate#ValidationException",
    Message: "The test's meanwhile step failed.",
  });
}

// A stand-in for the database's address on loopback, which passes each
// request on to the local DynamoDB and records what it asked for. A test
// can then count the reads and writes behind one request to the service.
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
        // When meanwhile fails, the transaction is refused with an error
        // the SDK does not send again, so the test sees the failure.
        // Dropping the connection would make the SDK resend it, and it
        // would go through as if nothing had met it.
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
