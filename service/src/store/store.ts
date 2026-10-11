// The store (ADR 13): the only code that reads or writes the table. Every
// key comes from keys.ts, every write goes through write(), which raises the
// account's version in the same transaction, and every read is strongly
// consistent and checks expiry itself, because DynamoDB removes expired
// items late (ADR 5).
import { randomBytes } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import type { AccountId } from "../identity";
import { keys } from "./keys";

// Every ask is deleted a month after it is posted (PRD, "Accounts and
// connection"). The page's demo notice says so.
export const askLifetimeDays = 30;

const dayMs = 86_400_000;

// An ask as the agent sent it, once its schema has parsed it.
export interface NewAsk {
  summary: string;
  area: string;
  spokenDetail: string;
  actionLink?: string;
  sessionLink?: string;
  replaces?: string;
}

const storedAskSchema = z.object({
  id: z.string(),
  summary: z.string(),
  area: z.string(),
  spokenDetail: z.string(),
  actionLink: z.string().optional(),
  sessionLink: z.string().optional(),
  replaces: z.string().optional(),
  postedAt: z.iso.datetime(),
  // When DynamoDB may delete the item, in seconds since the epoch.
  expiresAt: z.number().int(),
});

export type StoredAsk = Omit<z.output<typeof storedAskSchema>, "expiresAt">;

const metaSchema = z.object({
  version: z.number().int().nonnegative(),
  everAsked: z.boolean().optional(),
});

// What the page shows: the account's open asks, the version they were read
// at, and whether the account has ever had an ask.
export interface AccountAsks {
  version: number;
  everAsked: boolean;
  asks: StoredAsk[];
}

export interface Store {
  // Stores a new ask and gives its id.
  postAsk(account: AccountId, ask: NewAsk, now: Date): Promise<string>;
  openAsks(account: AccountId, now: Date): Promise<AccountAsks>;
  close(): void;
}

type Change = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

// An id is the only handle on an ask, so it is long and random (ADR 2):
// 144 bits, written in the characters a log line accepts.
const newAskId = () => randomBytes(18).toString("base64url");

const seconds = (time: number) => Math.floor(time / 1000);

export function createStore(config: {
  tableName: string;
  endpoint?: string | undefined;
}): Store {
  const { tableName: TableName, endpoint } = config;
  // In production the client finds its region and credentials in Lambda's
  // environment. The local DynamoDB of the tests accepts any.
  const client = new DynamoDBClient(
    endpoint === undefined
      ? {}
      : {
          endpoint,
          region: "us-east-1",
          credentials: { accessKeyId: "local", secretAccessKey: "local" },
        },
  );
  const db = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });

  // Every write to an account's items, as one transaction that also raises
  // the account's version, so the page learns of it (ADR 13).
  async function write(
    account: AccountId,
    changes: Change[],
    marks: { everAsked?: true } = {},
  ): Promise<void> {
    const set = marks.everAsked === true ? " SET everAsked = :yes" : "";
    await db.send(
      new TransactWriteCommand({
        TransactItems: [
          ...changes,
          {
            Update: {
              TableName,
              Key: keys.meta(account),
              UpdateExpression: `ADD version :one${set}`,
              ExpressionAttributeValues: {
                ":one": 1,
                ...(set === "" ? {} : { ":yes": true }),
              },
            },
          },
        ],
      }),
    );
  }

  async function meta(account: AccountId) {
    const { Item } = await db.send(
      new GetCommand({
        TableName,
        Key: keys.meta(account),
        ConsistentRead: true,
      }),
    );
    return Item === undefined
      ? { version: 0, everAsked: false }
      : metaSchema.parse(Item);
  }

  async function storedAsks(account: AccountId, now: Date) {
    const { pk, prefix } = keys.openAsks(account);
    const found: StoredAsk[] = [];
    let after: Record<string, unknown> | undefined;
    do {
      const page = await db.send(
        new QueryCommand({
          TableName,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
          ExpressionAttributeValues: { ":pk": pk, ":prefix": prefix },
          ConsistentRead: true,
          ExclusiveStartKey: after,
        }),
      );
      for (const item of page.Items ?? []) {
        const { expiresAt, ...ask } = storedAskSchema.parse(item);
        if (expiresAt > seconds(now.getTime())) found.push(ask);
      }
      after = page.LastEvaluatedKey;
    } while (after !== undefined);
    return found;
  }

  return {
    async postAsk(account, ask, now) {
      const id = newAskId();
      const item = {
        ...keys.openAsk(account, id),
        id,
        ...ask,
        postedAt: now.toISOString(),
        expiresAt: seconds(now.getTime() + askLifetimeDays * dayMs),
      };
      await write(
        account,
        [
          {
            Put: {
              TableName,
              Item: item,
              ConditionExpression: "attribute_not_exists(sk)",
            },
          },
        ],
        { everAsked: true },
      );
      return id;
    },

    // The version is read before the asks, never alongside them, so it is
    // never newer than the list it comes with. A write that lands between
    // the two reads raises the version again, and the page reads once more.
    async openAsks(account, now) {
      const { version, everAsked } = await meta(account);
      const asks = await storedAsks(account, now);
      return { version, everAsked: everAsked ?? false, asks };
    },

    close() {
      db.destroy();
    },
  };
}
