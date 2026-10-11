// Global setup for the integration tier: a real DynamoDB, run locally in
// Docker (ADR 9), with the table made from the deployment definition, so the
// atomic write and late expiry are the real store's. It listens on loopback
// only, so the offline guard lets tests reach it.
//
// Where the Docker daemon is not running, as in a Claude cloud session, it is
// started first.
import { execFile, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import {
  CreateTableCommand,
  DynamoDBClient,
  ListTablesCommand,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
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

export default async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  await dockerRunning();
  const { stdout } = await run("docker", [
    "run",
    "--detach",
    "--rm",
    "--publish",
    "127.0.0.1::8000",
    image,
    "-jar",
    "DynamoDBLocal.jar",
    "-inMemory",
    "-sharedDb",
  ]);
  const container = stdout.trim();
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
