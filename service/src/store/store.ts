// The store (ADR 13): the only code that reads or writes the table. Every
// key comes from keys.ts, and every read is strongly consistent and checks
// expiry itself, because DynamoDB removes expired items late (ADR 5).
//
// Two functions write. write() makes every change to asks or rules, and
// raises the account's version in the same transaction, so the page learns
// of it. count() adds to a rate counter, which changes nothing the page
// shows, so it leaves the version alone and an idle poll stays idle
// (ADR 18). Lint holds every other write out.
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { awsClientConfig } from "../aws";
import type { AccountId } from "../identity";
import {
  askLimit,
  pollLimit,
  rulesSaveLimit,
  secondsLeft,
  sortRetryLimit,
  windowOf,
} from "../rate";
import { hashtagWindow, type HashtagWindow } from "../rules";
import { levels, type Sort } from "../sort";
import { fingerprint } from "./fingerprint";
import { keys, type Key } from "./keys";

// Every ask is deleted a month after it is posted (PRD, "Accounts and
// connection"). The page's demo notice says so.
export const askLifetimeDays = 30;

// An ask identical to one the account posted this many minutes ago or less
// is the same ask, and gets the first one's id (ADR 3).
export const dedupeWindowMinutes = 10;

// The most asks an account may post in a UTC day, which limits abuse (PRD,
// "Accounts and connection").
export const dailyAskCap = 100;

// How long the table keeps a day's count after the day ends.
const usageKeptDays = 3;

const dayMs = 86_400_000;
const minuteMs = 60_000;

// A rate counter is kept an hour past its window, then DynamoDB may delete
// it. It is only counted inside its own window, so it is never read after
// it expires (ADR 18).
const counterLifetimeMs = 3_600_000;

// How many times write() sends a transaction that DynamoDB keeps cancelling
// because another transaction holds one of its items, as two writes to one
// account do on META. Before each retry it waits a random time, up to a
// limit that starts at firstWaitMs and doubles, so that two writes which met
// once are unlikely to meet again. All the waits together are under 200ms.
export const writeTries = 4;
const firstWaitMs = 25;

// An ask as the agent sent it, once its schema has parsed it.
export interface NewAsk {
  summary: string;
  area: string;
  spokenDetail: string;
  actionLink?: string;
  sessionLink?: string;
  replaces?: string;
}

// What sorting decided about an ask, with the version of the rules it read
// (ADR 13), so a sort made with older rules can be told apart.
const sortSchema = z.object({
  hashtags: z.array(z.string()),
  level: z.enum(levels),
  reason: z.string(),
  rulesVersion: z.number().int().nonnegative(),
  sortedAt: z.iso.datetime(),
});

export type StoredSort = z.output<typeof sortSchema>;

// A sort as the sorter hands it in, with the rules version it read.
export type NewSort = Sort & { rulesVersion: number };

const storedAskSchema = z.object({
  id: z.string(),
  summary: z.string(),
  area: z.string(),
  spokenDetail: z.string(),
  actionLink: z.string().optional(),
  sessionLink: z.string().optional(),
  replaces: z.string().optional(),
  postedAt: z.iso.datetime(),
  // When the item was stored. A replacing ask keeps the posting time of the
  // ask it replaces (ADR 13), but is stored when it is posted.
  storedAt: z.iso.datetime(),
  // When DynamoDB may delete the item, in seconds since the epoch.
  expiresAt: z.number().int(),
  // Absent until the ask is sorted.
  sort: sortSchema.optional(),
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
// for the day.
export type Posting =
  | { kind: "posted"; id: string; replaced: boolean }
  | { kind: "matched"; id: string }
  | { kind: "over-cap"; resetsAt: Date };

// The record that an ask was posted, kept while a repeat of it is matched.
const dedupeSchema = z.object({
  askId: z.string(),
  expiresAt: z.number().int(),
});

// The account's rules: the text the person wrote, the hashtags read from
// it in the order the rules give them, and every hashtag the account has
// had, in the order each first appeared, which keeps each one's colour
// (docs/design.md). The version goes up on every save. When the last save
// could not be read, the hashtags are the ones read before it.
//
// The hours are the windows read with the hashtags, absent when the rules
// give no hashtag any, and the time zone is the one the browser that saved
// the rules was in, which the hours use, absent until a save sends one.
const rulesSchema = z.object({
  text: z.string(),
  hashtags: z.array(z.string()),
  seen: z.array(z.string()),
  version: z.number().int().nonnegative(),
  readFailed: z.boolean(),
  hours: z.array(hashtagWindow).min(1).optional(),
  timeZone: z.string().optional(),
});

export type AccountRules = z.output<typeof rulesSchema>;

// The rules of an account that has never saved any: an empty box, and no
// hashtags.
const noRules: AccountRules = {
  text: "",
  hashtags: [],
  seen: [],
  version: 0,
  readFailed: false,
};

// The hours as the rules item holds them: absent when there are none.
const windowsOf = (hours: HashtagWindow[] | undefined) =>
  hours === undefined || hours.length === 0 ? {} : { hours };

// Rules as a save hands them in: the text, the time zone of the browser
// that saved them, and the hashtags read from it with their hours. Without
// a time zone, the one saved before stays. Without hashtags, the rules
// could not be read, and the hashtags and hours read before stay.
export interface NewRules {
  text: string;
  timeZone?: string | undefined;
  hashtags?: string[];
  // Read with the hashtags. With hashtags and no hours, every hashtag shows
  // at any time.
  hours?: HashtagWindow[];
}

// An open ask, with the account's rules, for the sorter.
export interface AskToSort {
  ask: StoredAsk;
  rules: AccountRules;
}

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

// What a poll gets when nothing changed since the version it carried.
export interface Unchanged {
  version: number;
  unchanged: true;
}

// Whether a call was counted, or how long until its limit allows another.
export type Counted =
  { counted: true } | { counted: false; secondsLeft: number };

export interface Store {
  // Stores a new ask and gives its id. When the ask names an open ask of the
  // same account in replaces, it takes that ask's place, and that ask closes
  // as replaced. Otherwise it is posted as new. An ask identical to one
  // posted in the last ten minutes stores nothing and gives that one's id.
  // An account over its daily cap stores nothing.
  postAsk(account: AccountId, ask: NewAsk, now: Date): Promise<Posting>;
  // Closes an open ask as resolved.
  resolveAsk(account: AccountId, askId: string, now: Date): Promise<Resolution>;
  openAsks(account: AccountId, now: Date): Promise<AccountAsks>;
  // The open asks, unless the version is still the one the page last saw.
  asksSince(
    account: AccountId,
    since: number | undefined,
    now: Date,
  ): Promise<AccountAsks | Unchanged>;
  // Counts a poll against the account's limit for the minute.
  countPoll(account: AccountId, now: Date): Promise<Counted>;
  // Counts a call to the ask tool against the account's limit for the
  // minute.
  countAsk(account: AccountId, now: Date): Promise<Counted>;
  // The account's rules.
  rules(account: AccountId): Promise<AccountRules>;
  // Saves the rules text and the time zone, and the hashtags read from it
  // with their hours when there are some. With none, the old hashtags and
  // hours stay, and the rules are marked as not read.
  saveRules(
    account: AccountId,
    rules: NewRules,
    now: Date,
  ): Promise<AccountRules>;
  // Counts a save of the rules against the account's limit for the minute.
  countRulesSave(account: AccountId, now: Date): Promise<Counted>;
  // An open ask and the account's rules, or undefined when the ask is not
  // open.
  askToSort(
    account: AccountId,
    askId: string,
    now: Date,
  ): Promise<AskToSort | undefined>;
  // Stores what sorting decided on an open ask. False when the ask is no
  // longer open, or already holds a sort made with newer rules.
  recordSort(
    account: AccountId,
    askId: string,
    sort: NewSort,
    now: Date,
  ): Promise<boolean>;
  // Counts a poll's request to sort an ask again against the account's
  // limit for the minute.
  countSortRetry(account: AccountId, now: Date): Promise<Counted>;
  close(): void;
}

type Change = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

// An id is the only handle on an ask, so it is long and random (ADR 2):
// 144 bits, written in the characters a log line accepts.
const newAskId = () => randomBytes(18).toString("base64url");

const seconds = (time: number) => Math.floor(time / 1000);

// When a transaction was cancelled, the reason DynamoDB gave for each of its
// changes, in order.
const reasonCodes = (error: unknown): (string | undefined)[] | undefined =>
  error instanceof TransactionCanceledException
    ? (error.CancellationReasons ?? []).map((reason) => reason.Code)
    : undefined;

// When a transaction was refused because a condition failed, whether each
// of its changes, in order, was one whose condition failed.
function failedChanges(error: unknown): boolean[] | undefined {
  const failed = reasonCodes(error)?.map(
    (code) => code === "ConditionalCheckFailed",
  );
  return failed?.includes(true) === true ? failed : undefined;
}

// Whether a transaction was refused because one of its conditions failed,
// as when another call closed the same ask first.
const conditionFailed = (error: unknown) => failedChanges(error) !== undefined;

// The start of the next UTC day, when a day's count starts again.
const nextDay = (now: Date) =>
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);

// Whether a transaction was refused only because another transaction held
// one of its items: an item names a conflict, and no item names anything
// else. DynamoDB cancels it whole, so sending it again is safe. Any other
// reason, such as a failed condition, goes back to the caller.
const conflicted = (error: unknown) => {
  const codes = reasonCodes(error) ?? [];
  return (
    codes.includes("TransactionConflict") &&
    codes.every((code) => code === "TransactionConflict" || code === "None")
  );
};

export function createStore(config: {
  tableName: string;
  endpoint?: string | undefined;
}): Store {
  const { tableName: TableName, endpoint } = config;
  const client = new DynamoDBClient(awsClientConfig(endpoint));
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
    const items: Change[] = [
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
    ];
    // The SDK does not retry a cancelled transaction, so this does.
    for (let tries = 1; ; tries += 1) {
      try {
        await db.send(new TransactWriteCommand({ TransactItems: items }));
        return;
      } catch (error) {
        if (!conflicted(error) || tries === writeTries) throw error;
      }
      await sleep(Math.random() * firstWaitMs * 2 ** (tries - 1));
    }
  }

  // The update that adds one to a counter while it is under its limit, and
  // sets when the item expires the first time it is counted. A rate counter
  // makes it alone, through count(), and the day's count makes it as part of
  // posting's transaction, through write().
  function counting(key: Key, limit: number, expiresAt: number) {
    return {
      TableName,
      Key: key,
      UpdateExpression:
        "ADD #count :one SET expiresAt = if_not_exists(expiresAt, :expiresAt)",
      ConditionExpression: "attribute_not_exists(#count) OR #count < :limit",
      ExpressionAttributeNames: { "#count": "count" },
      ExpressionAttributeValues: {
        ":one": 1,
        ":limit": limit,
        ":expiresAt": expiresAt,
      },
    };
  }

  // Adds one to a rate counter, unless it has reached its limit. One
  // conditional update, which never raises the version (ADR 18).
  async function count(
    key: Key,
    limit: number,
    expiresAt: number,
  ): Promise<boolean> {
    try {
      await db.send(new UpdateCommand(counting(key, limit, expiresAt)));
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return false;
      throw error;
    }
  }

  // Counts a call against a limit for the window it falls in.
  async function countIn(
    key: (window: string) => Key,
    limit: number,
    windowMinutes: number,
    now: Date,
  ): Promise<Counted> {
    const window = windowOf(now, windowMinutes);
    const counted = await count(
      key(window.name),
      limit,
      seconds(window.endsAt + counterLifetimeMs),
    );
    return counted
      ? { counted: true }
      : { counted: false, secondsLeft: secondsLeft(window, now) };
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

  async function readRules(account: AccountId): Promise<AccountRules> {
    const { Item } = await db.send(
      new GetCommand({
        TableName,
        Key: keys.rules(account),
        ConsistentRead: true,
      }),
    );
    return Item === undefined ? noRules : rulesSchema.parse(Item);
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

  // The change that adds a posted ask to the day's count, made only while
  // the count is under the cap. It is part of posting's transaction
  // (ADR 13), where a rate counter is written alone, by count() (ADR 18).
  // The count is named by its day, so it is counted against only on that
  // day, before it expires.
  function countingTheDay(account: AccountId, now: Date): Change {
    return {
      Update: counting(
        keys.usage(account, now),
        dailyAskCap,
        seconds(nextDay(now) + usageKeptDays * dayMs),
      ),
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

  // The open asks, with the version read before them, never alongside, so
  // it is never newer than the list it comes with. A write that lands
  // between the two reads raises the version again, and the page reads once
  // more.
  async function listed(
    account: AccountId,
    now: Date,
    { version, everAsked }: z.output<typeof metaSchema>,
  ): Promise<AccountAsks> {
    const asks = await storedAsks(account, now);
    return { version, everAsked: everAsked ?? false, asks };
  }

  return {
    async postAsk(account, ask, now) {
      const id = newAskId();
      const time = now.getTime();
      const record = keys.dedupe(account, fingerprint(ask));
      // Every post makes these changes first, and in this order, so a
      // refusal can be read by place (ADR 13). The dedupe record is written
      // only if none is live, and holds the new ask's id. The day's count is
      // raised only while under the cap.
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
        countingTheDay(account, now),
      ];
      const put = (since: Pick<OpenItem, "postedAt" | "expiresAt">) => ({
        Put: {
          TableName,
          Item: {
            ...keys.openAsk(account, id),
            id,
            ...ask,
            ...since,
            storedAt: now.toISOString(),
          },
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
          const [repeat, overCap, ...later] = failed;
          if (repeat === true) {
            const first = await stored(record, dedupeSchema, now);
            if (first === undefined) throw error;
            return { kind: "matched", id: first.askId };
          }
          if (overCap === true) {
            return { kind: "over-cap", resetsAt: new Date(nextDay(now)) };
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

    async openAsks(account, now) {
      return listed(account, now, await meta(account));
    },

    // When the version is the one the page sent, nothing but the version is
    // read (ADR 13).
    async asksSince(account, since, now) {
      const marker = await meta(account);
      if (marker.version === since) {
        return { version: marker.version, unchanged: true };
      }
      return listed(account, now, marker);
    },

    async countPoll(account, now) {
      return countIn(
        (window) => keys.pollCount(account, window),
        pollLimit.polls,
        pollLimit.windowMinutes,
        now,
      );
    },

    async countAsk(account, now) {
      return countIn(
        (window) => keys.askCount(account, window),
        askLimit.asks,
        askLimit.windowMinutes,
        now,
      );
    },

    rules: readRules,

    // Each save starts from the rules as they are, and is written only if
    // no other save landed in between, so no hashtag drops out of seen.
    async saveRules(account, { text, timeZone, hashtags, hours }, now) {
      for (let tries = 0; ; tries += 1) {
        const current = await readRules(account);
        const read = hashtags ?? current.hashtags;
        const next: AccountRules = {
          text,
          hashtags: read,
          seen: [
            ...current.seen,
            ...read.filter((name) => !current.seen.includes(name)),
          ],
          version: current.version + 1,
          readFailed: hashtags === undefined,
          ...windowsOf(hashtags === undefined ? current.hours : hours),
          timeZone: timeZone ?? current.timeZone,
        };
        try {
          await write(account, [
            {
              Put: {
                TableName,
                Item: {
                  ...keys.rules(account),
                  ...next,
                  savedAt: now.toISOString(),
                },
                ConditionExpression:
                  current.version === 0
                    ? "attribute_not_exists(sk)"
                    : "version = :current",
                ...(current.version === 0
                  ? {}
                  : {
                      ExpressionAttributeValues: {
                        ":current": current.version,
                      },
                    }),
              },
            },
          ]);
          return next;
        } catch (error) {
          // Another save landed after this one read the rules.
          if (!conditionFailed(error) || tries >= 4) throw error;
        }
      }
    },

    async countRulesSave(account, now) {
      return countIn(
        (window) => keys.rulesSaveCount(account, window),
        rulesSaveLimit.saves,
        rulesSaveLimit.windowMinutes,
        now,
      );
    },

    async askToSort(account, askId, now) {
      const open = await stored(
        keys.openAsk(account, askId),
        storedAskSchema,
        now,
      );
      if (open === undefined) return undefined;
      return {
        ask: storedAskSchema.omit({ expiresAt: true }).parse(open),
        rules: await readRules(account),
      };
    },

    // The sort is written only onto an ask that is still open, and never
    // over one made with newer rules.
    async recordSort(account, askId, sort, now) {
      try {
        await write(account, [
          {
            Update: {
              TableName,
              Key: keys.openAsk(account, askId),
              UpdateExpression: "SET #sort = :sort",
              ConditionExpression:
                "attribute_exists(sk) AND (attribute_not_exists(#sort) OR #sort.rulesVersion <= :rulesVersion)",
              ExpressionAttributeNames: { "#sort": "sort" },
              ExpressionAttributeValues: {
                ":sort": { ...sort, sortedAt: now.toISOString() },
                ":rulesVersion": sort.rulesVersion,
              },
            },
          },
        ]);
        return true;
      } catch (error) {
        if (conditionFailed(error)) return false;
        throw error;
      }
    },

    async countSortRetry(account, now) {
      return countIn(
        (window) => keys.sortRetryCount(account, window),
        sortRetryLimit.retries,
        sortRetryLimit.windowMinutes,
        now,
      );
    },

    close() {
      db.destroy();
    },
  };
}
