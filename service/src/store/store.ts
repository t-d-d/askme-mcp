// The store (ADR 13): the only code that reads or writes the table. Every
// key comes from keys.ts, every write goes through write(), which raises the
// account's version in the same transaction, and every read is strongly
// consistent and checks expiry itself, because DynamoDB removes expired
// items late (ADR 5).
import { randomBytes } from "node:crypto";
import {
  DynamoDBClient,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import type { AccountId } from "../identity";
import { fingerprint } from "./fingerprint";
import { keys, type Key } from "./keys";

// Every ask is deleted a month after it is posted (PRD, "Accounts and
// connection"). The page's demo notice says so.
export const askLifetimeDays = 30;

// An ask identical to one the account posted this many minutes ago or less
// is the same ask, and gets the first one's id (ADR 3).
export const dedupeWindowMinutes = 10;

// The most asks an account may post in a UTC day, which limits abuse (PRD,
// "Accounts and connection"), and in one minute, which slows an agent that
// floods before it uses up the day.
export const dailyAskCap = 100;
export const asksPerMinute = 30;

// How long the table keeps a day's count after the day ends.
const usageKeptDays = 3;

const dayMs = 86_400_000;
const minuteMs = 60_000;

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

type OpenItem = z.output<typeof storedAskSchema>;

// How an ask ended (PRD, "The ask"). An agent resolved it, or a later ask
// replaced it.
export type Ending = "resolved" | "replaced";

// A closed ask is the same ask, plus how and when it ended.
const closedAskSchema = storedAskSchema.extend({
  endedAs: z.enum(["resolved", "replaced"] satisfies Ending[]),
  closedAt: z.iso.datetime(),
});

// What resolving an ask found: an open ask, which it closed, one that was
// already closed, or no ask under that id in the account.
export type Resolution = "resolved" | "already-closed" | "not-found";

// What posting an ask came to: a new ask, with whether it took over from an
// open ask it named; a repeat of an ask posted in the last ten minutes, with
// that ask's id; or a refusal, because the account has posted all its asks
// for the day, or too many this minute.
export type Posting =
  | { kind: "posted"; id: string; replaced: boolean }
  | { kind: "matched"; id: string }
  | { kind: "over-cap"; resetsAt: Date }
  | { kind: "too-fast"; waitSeconds: number };

// The record that an ask was posted, kept while a repeat of it is matched.
const dedupeSchema = z.object({
  askId: z.string(),
  expiresAt: z.number().int(),
});

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
  // Stores a new ask and gives its id. When the ask names an open ask of the
  // same account in replaces, it takes that ask's place, and that ask closes
  // as replaced. Otherwise it is posted as new. An ask identical to one
  // posted in the last ten minutes stores nothing and gives that one's id.
  // An account over its daily cap or its rate stores nothing.
  postAsk(account: AccountId, ask: NewAsk, now: Date): Promise<Posting>;
  // Closes an open ask as resolved.
  resolveAsk(account: AccountId, askId: string, now: Date): Promise<Resolution>;
  openAsks(account: AccountId, now: Date): Promise<AccountAsks>;
  close(): void;
}

type Change = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

// An id is the only handle on an ask, so it is long and random (ADR 2):
// 144 bits, written in the characters a log line accepts.
const newAskId = () => randomBytes(18).toString("base64url");

const seconds = (time: number) => Math.floor(time / 1000);

// When a transaction was refused because a condition failed, whether each
// of its changes, in order, was one whose condition failed.
function failedChanges(error: unknown): boolean[] | undefined {
  if (!(error instanceof TransactionCanceledException)) return undefined;
  const failed = (error.CancellationReasons ?? []).map(
    (reason) => reason.Code === "ConditionalCheckFailed",
  );
  return failed.includes(true) ? failed : undefined;
}

// Whether a transaction was refused because one of its conditions failed,
// as when another call closed the same ask first.
const conditionFailed = (error: unknown) => failedChanges(error) !== undefined;

// The start of the next UTC day, when a day's count starts again.
const nextDay = (now: Date) =>
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);

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

  // The item under one key, unless it is missing or has expired.
  async function stored<Item extends { expiresAt: number }>(
    key: Key,
    schema: z.ZodType<Item>,
    now: Date,
  ): Promise<Item | undefined> {
    const { Item } = await db.send(
      new GetCommand({ TableName, Key: key, ConsistentRead: true }),
    );
    if (Item === undefined) return undefined;
    const item = schema.parse(Item);
    return item.expiresAt > seconds(now.getTime()) ? item : undefined;
  }

  // The changes that close an open ask, for one transaction: the open item
  // goes, and a closed item takes its place, saying how the ask ended. The
  // open item must still be there, so one ask cannot be closed twice.
  function closing(
    account: AccountId,
    ask: OpenItem,
    endedAs: Ending,
    now: Date,
  ): Change[] {
    return [
      {
        Delete: {
          TableName,
          Key: keys.openAsk(account, ask.id),
          ConditionExpression: "attribute_exists(sk)",
        },
      },
      {
        Put: {
          TableName,
          Item: {
            ...keys.closedAsk(account, ask.id),
            ...ask,
            endedAs,
            closedAt: now.toISOString(),
          },
        },
      },
    ];
  }

  // The change that adds one to a count, made only while the count is under
  // its limit. A count is named by its day or its minute, so it is counted
  // against only within that time, before it expires.
  function counting(key: Key, limit: number, expiresAt: number): Change {
    return {
      Update: {
        TableName,
        Key: key,
        UpdateExpression: "ADD asks :one SET expiresAt = :expiresAt",
        ConditionExpression: "attribute_not_exists(asks) OR asks < :limit",
        ExpressionAttributeValues: {
          ":one": 1,
          ":limit": limit,
          ":expiresAt": expiresAt,
        },
      },
    };
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
      const time = now.getTime();
      const record = keys.dedupe(account, fingerprint(ask));
      const dayEnds = nextDay(now);
      const minuteEnds = (Math.floor(time / minuteMs) + 1) * minuteMs;
      // Every post makes these changes first, and in this order, so a
      // refusal can be read by place (ADR 13). The dedupe record is written
      // only if none is live, and holds the new ask's id. The day's count and
      // the minute's count are each raised only while under their limits.
      const guards: Change[] = [
        {
          Put: {
            TableName,
            Item: {
              ...record,
              askId: id,
              expiresAt: seconds(time + dedupeWindowMinutes * minuteMs),
            },
            ConditionExpression:
              "attribute_not_exists(sk) OR expiresAt <= :now",
            ExpressionAttributeValues: { ":now": seconds(time) },
          },
        },
        counting(
          keys.usage(account, now),
          dailyAskCap,
          seconds(dayEnds + usageKeptDays * dayMs),
        ),
        counting(
          keys.rate(account, now),
          asksPerMinute,
          seconds(minuteEnds + minuteMs),
        ),
      ];
      const put = (since: Pick<OpenItem, "postedAt" | "expiresAt">) => ({
        Put: {
          TableName,
          Item: { ...keys.openAsk(account, id), id, ...ask, ...since },
          ConditionExpression: "attribute_not_exists(sk)",
        },
      });

      // The guards and the changes as one transaction. A guard that refuses
      // decides the answer. A later change that refuses is left to the
      // caller, as "refused".
      async function guarded(
        changes: Change[],
        posted: Posting,
      ): Promise<Posting | "refused"> {
        try {
          await write(account, [...guards, ...changes], { everAsked: true });
          return posted;
        } catch (error) {
          const failed = failedChanges(error);
          if (failed === undefined) throw error;
          const [repeat, overCap, tooFast, ...later] = failed;
          if (repeat === true) {
            const first = await stored(record, dedupeSchema, now);
            if (first === undefined) throw error;
            return { kind: "matched", id: first.askId };
          }
          if (overCap === true) {
            return { kind: "over-cap", resetsAt: new Date(dayEnds) };
          }
          if (tooFast === true) {
            return {
              kind: "too-fast",
              waitSeconds: Math.ceil((minuteEnds - time) / 1000),
            };
          }
          if (later.some(Boolean)) return "refused";
          throw error;
        }
      }

      const old =
        ask.replaces === undefined
          ? undefined
          : await stored(
              keys.openAsk(account, ask.replaces),
              storedAskSchema,
              now,
            );
      if (old !== undefined) {
        // The new ask has waited as long as the one it replaces, and goes
        // when that one would have (ADR 13).
        const replacing = await guarded(
          [
            put({ postedAt: old.postedAt, expiresAt: old.expiresAt }),
            ...closing(account, old, "replaced", now),
          ],
          { kind: "posted", id, replaced: true },
        );
        // Refused when the old ask closed after it was read, so this one is
        // new.
        if (replacing !== "refused") return replacing;
      }
      const posting = await guarded(
        [
          put({
            postedAt: now.toISOString(),
            expiresAt: seconds(time + askLifetimeDays * dayMs),
          }),
        ],
        { kind: "posted", id, replaced: false },
      );
      if (posting === "refused") {
        throw new Error("A new ask's id was already in use.");
      }
      return posting;
    },

    async resolveAsk(account, askId, now) {
      const open = await stored(
        keys.openAsk(account, askId),
        storedAskSchema,
        now,
      );
      if (open !== undefined) {
        try {
          await write(account, closing(account, open, "resolved", now));
          return "resolved";
        } catch (error) {
          // Another call closed it after it was read.
          if (!conditionFailed(error)) throw error;
        }
      }
      const closed = await stored(
        keys.closedAsk(account, askId),
        closedAskSchema,
        now,
      );
      return closed === undefined ? "not-found" : "already-closed";
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
