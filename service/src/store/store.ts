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
import { rateLimits, secondsLeft, windowOf, type LimitName } from "../rate";
import { exampleRules, hashtagWindow, type HashtagWindow } from "../rules";
import { levels, type Sort } from "../sort";
import { fingerprint } from "./fingerprint";
import { keys, type Key } from "./keys";

// The page's demo notice states this lifetime.
export const askLifetimeDays = 30;

export const dedupeWindowMinutes = 10;

// Counted per UTC day.
export const dailyAskCap = 100;

const usageKeptDays = 3;

const dayMs = 86_400_000;
const minuteMs = 60_000;

const counterLifetimeMs = 3_600_000;

// Any two write() calls for one account at once conflict, because each
// raises the version on META. write() retries only that conflict, so one
// call sends at most writeTries refused transactions.
export const writeTries = 4;
const firstWaitMs = 25;

export interface NewAsk {
  summary: string;
  area: string;
  spokenDetail: string;
  actionLink?: string;
  sessionLink?: string;
  replaces?: string;
  staleAfterMinutes?: number;
}

const sortSchema = z.object({
  hashtags: z.array(z.string()),
  level: z.enum(levels),
  reason: z.string(),
  rulesVersion: z.number().int().nonnegative(),
  sortedAt: z.iso.datetime(),
});

export type StoredSort = z.output<typeof sortSchema>;

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
  // Differs from postedAt for a replacing ask, which keeps the postedAt of
  // the ask it replaces.
  storedAt: z.iso.datetime(),
  // Seconds since the epoch, as DynamoDB's TTL reads it.
  expiresAt: z.number().int(),
  sort: sortSchema.optional(),
  // When the person first followed one of the ask's links. The ask stays
  // open.
  openedAt: z.iso.datetime().optional(),
  lapsesAt: z.iso.datetime().optional(),
});

export type StoredAsk = Omit<z.output<typeof storedAskSchema>, "expiresAt">;

type OpenItem = z.output<typeof storedAskSchema>;

export type Ending = "resolved" | "dismissed" | "replaced";

const closedAskSchema = storedAskSchema.extend({
  endedAs: z.enum(["resolved", "dismissed", "replaced"] satisfies Ending[]),
  closedAt: z.iso.datetime(),
});

export type Resolution = "resolved" | "already-closed" | "not-found";

export type Opening = "opened" | "unchanged" | "not-found";
export type Dismissal = "dismissed" | "unchanged" | "not-found";

export type Posting =
  | { kind: "posted"; id: string; replaced: boolean }
  | { kind: "matched"; id: string }
  | { kind: "over-cap"; resetsAt: Date };

const dedupeSchema = z.object({
  askId: z.string(),
  expiresAt: z.number().int(),
});

// view.ts colours a hashtag by its place in seen, so seen only grows, in
// the order each hashtag first appeared. The hours use timeZone, the zone
// of the browser that saved the rules.
const rulesSchema = z.object({
  text: z.string(),
  hashtags: z.array(z.string()),
  seen: z.array(z.string()),
  version: z.number().int().nonnegative(),
  readFailed: z.boolean(),
  savedAt: z.iso.datetime().optional(),
  hours: z.array(hashtagWindow).min(1).optional(),
  timeZone: z.string().optional(),
});

export type AccountRules = z.output<typeof rulesSchema>;

const windowsOf = (hours: HashtagWindow[] | undefined) =>
  hours === undefined || hours.length === 0 ? {} : { hours };

// Read while an account has no rules item. Seeding seen keeps each example
// hashtag's colour after the person saves their own rules. A save of them
// unchanged stores them at version 0 (ADR 22), so the version stays at 0
// until the first save that reads rules.
const firstRules: AccountRules = {
  text: exampleRules.text,
  hashtags: [...exampleRules.reading.hashtags],
  seen: [...exampleRules.reading.hashtags],
  version: 0,
  readFailed: false,
  ...windowsOf(exampleRules.reading.hours),
};

export interface NewRules {
  text: string;
  timeZone?: string | undefined;
  // Absent when the rules could not be read.
  hashtags?: string[];
  hours?: HashtagWindow[];
}

export interface AskToSort {
  ask: StoredAsk;
  rules: AccountRules;
}

const metaSchema = z.object({
  version: z.number().int().nonnegative(),
  everAsked: z.boolean().optional(),
  modelCapResetsAt: z.iso.datetime().optional(),
});

export interface AccountAsks {
  version: number;
  everAsked: boolean;
  asks: StoredAsk[];
  modelCapResetsAt?: string;
}

const counterSchema = z.object({
  count: z.number().int().nonnegative(),
  expiresAt: z.number().int(),
});

export interface Unchanged {
  version: number;
  unchanged: true;
}

export type Counted =
  { counted: true } | { counted: false; secondsLeft: number };

export interface Store {
  postAsk(account: AccountId, ask: NewAsk, now: Date): Promise<Posting>;
  resolveAsk(account: AccountId, askId: string, now: Date): Promise<Resolution>;
  markOpened(account: AccountId, askId: string, now: Date): Promise<Opening>;
  dismissAsk(account: AccountId, askId: string, now: Date): Promise<Dismissal>;
  openAsks(account: AccountId, now: Date): Promise<AccountAsks>;
  asksSince(
    account: AccountId,
    since: number | undefined,
    now: Date,
  ): Promise<AccountAsks | Unchanged>;
  countCall(account: AccountId, limit: LimitName, now: Date): Promise<Counted>;
  rules(account: AccountId): Promise<AccountRules>;
  saveRules(
    account: AccountId,
    rules: NewRules,
    now: Date,
  ): Promise<AccountRules>;
  // Saves unchanged rules whose last reading succeeded without raising the
  // rules version, so no ask sorted with them falls behind (ADR 22).
  // Undefined, saving nothing, once another save has changed them.
  resaveRules(
    account: AccountId,
    rules: Pick<NewRules, "text" | "timeZone">,
    now: Date,
  ): Promise<AccountRules | undefined>;
  modelCapSpent(account: AccountId, now: Date): Promise<boolean>;
  // False, writing nothing, when META already holds that time or a later
  // one.
  recordModelCapReset(account: AccountId, resetsAt: Date): Promise<boolean>;
  askToSort(
    account: AccountId,
    askId: string,
    now: Date,
  ): Promise<AskToSort | undefined>;
  // False when the ask is no longer open, or already holds a sort made with
  // newer rules.
  recordSort(
    account: AccountId,
    askId: string,
    sort: NewSort,
    now: Date,
  ): Promise<boolean>;
  close(): void;
}

type Change = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

// The id is the only handle on an ask, so it is long and random (ADR 2).
// base64url keeps it inside the id pattern in log.ts.
const newAskId = () => randomBytes(18).toString("base64url");

const seconds = (time: number) => Math.floor(time / 1000);

// DynamoDB gives one reason for each change, in the transaction's order.
const reasonCodes = (error: unknown): (string | undefined)[] | undefined =>
  error instanceof TransactionCanceledException
    ? (error.CancellationReasons ?? []).map((reason) => reason.Code)
    : undefined;

function failedChanges(error: unknown): boolean[] | undefined {
  const failed = reasonCodes(error)?.map(
    (code) => code === "ConditionalCheckFailed",
  );
  return failed?.includes(true) === true ? failed : undefined;
}

const conditionFailed = (error: unknown) => failedChanges(error) !== undefined;

const nextDay = (now: Date) =>
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);

// DynamoDB cancels a transaction whole, so one refused only for conflicts
// is safe to send again.
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

  // Every change to asks or rules goes through here, and raises the version
  // on META in the same transaction so the page learns of it (ADR 13).
  async function write(
    account: AccountId,
    changes: Change[],
    marks: { everAsked?: true; modelCapResetsAt?: string } = {},
  ): Promise<void> {
    const { everAsked, modelCapResetsAt } = marks;
    const sets = [
      ...(everAsked === true ? ["everAsked = :yes"] : []),
      ...(modelCapResetsAt === undefined
        ? []
        : ["modelCapResetsAt = :resetsAt"]),
    ];
    const items: Change[] = [
      ...changes,
      {
        Update: {
          TableName,
          Key: keys.meta(account),
          UpdateExpression: `ADD version :one${sets.length === 0 ? "" : ` SET ${sets.join(", ")}`}`,
          ExpressionAttributeValues: {
            ":one": 1,
            ...(everAsked === true ? { ":yes": true } : {}),
            ...(modelCapResetsAt === undefined
              ? {}
              : { ":resetsAt": modelCapResetsAt }),
          },
          ...(modelCapResetsAt === undefined
            ? {}
            : {
                ConditionExpression:
                  "attribute_not_exists(modelCapResetsAt) OR modelCapResetsAt < :resetsAt",
              }),
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

  // A rate counter changes nothing the page shows, so it is written outside
  // write() and leaves the version alone. An idle poll stays idle (ADR 18).
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

  const counterKeys: Readonly<
    Record<LimitName, (account: AccountId, window: string) => Key>
  > = {
    poll: keys.pollCount,
    ask: keys.askCount,
    rulesSave: keys.rulesSaveCount,
    modelCall: keys.modelCount,
  };

  async function countIn(
    account: AccountId,
    name: LimitName,
    now: Date,
  ): Promise<Counted> {
    const { limit, windowMinutes } = rateLimits[name];
    const window = windowOf(now, windowMinutes);
    const counted = await count(
      counterKeys[name](account, window.name),
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
    return Item === undefined ? firstRules : rulesSchema.parse(Item);
  }

  async function replaceRules(
    account: AccountId,
    current: AccountRules,
    next: AccountRules,
  ): Promise<void> {
    await write(account, [
      {
        Put: {
          TableName,
          Item: { ...keys.rules(account), ...next },
          ConditionExpression: "attribute_not_exists(sk) OR version = :current",
          ExpressionAttributeValues: { ":current": current.version },
        },
      },
    ]);
  }

  // Every read is strongly consistent (ADR 13). DynamoDB deletes expired
  // items late, so every read checks expiry too (ADR 5).
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

  // The condition on the open item stops one ask being closed twice.
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

  // Unlike a rate counter, the day's count is raised inside posting's
  // transaction, so only an ask that is stored counts (ADR 13).
  function countingTheDay(account: AccountId, now: Date): Change {
    return {
      Update: counting(
        keys.usage(account, now),
        dailyAskCap,
        seconds(nextDay(now) + usageKeptDays * dayMs),
      ),
    };
  }

  async function closeAs(
    account: AccountId,
    askId: string,
    endedAs: Ending,
    now: Date,
  ): Promise<"closed" | "already-closed" | "not-found"> {
    const open = await stored(
      keys.openAsk(account, askId),
      storedAskSchema,
      now,
    );
    if (open !== undefined) {
      try {
        await write(account, closing(account, open, endedAs, now));
        return "closed";
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

  // META must be read before the asks, never alongside, so the version is
  // never newer than the list. A write between the two reads raises it
  // again, and the page reads once more.
  async function listed(
    account: AccountId,
    now: Date,
    { version, everAsked, modelCapResetsAt }: z.output<typeof metaSchema>,
  ): Promise<AccountAsks> {
    const asks = await storedAsks(account, now);
    return {
      version,
      everAsked: everAsked ?? false,
      asks,
      ...(modelCapResetsAt === undefined ? {} : { modelCapResetsAt }),
    };
  }

  return {
    async postAsk(account, ask, now) {
      const id = newAskId();
      const time = now.getTime();
      const record = keys.dedupe(account, fingerprint(ask));
      // guarded() reads a refusal by place, so these come first and in this
      // order.
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
      // Counted from this post, even when a replacing ask keeps an older
      // postedAt.
      const { staleAfterMinutes, ...sent } = ask;
      const lapse =
        staleAfterMinutes === undefined
          ? {}
          : {
              lapsesAt: new Date(
                time + staleAfterMinutes * minuteMs,
              ).toISOString(),
            };
      const put = (since: Pick<OpenItem, "postedAt" | "expiresAt">) => ({
        Put: {
          TableName,
          Item: {
            ...keys.openAsk(account, id),
            id,
            ...sent,
            ...lapse,
            ...since,
            storedAt: now.toISOString(),
          },
          ConditionExpression: "attribute_not_exists(sk)",
        },
      });

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
        // A replacement keeps the old ask's age and expiry (ADR 13).
        const replacing = await guarded(
          [
            put({ postedAt: old.postedAt, expiresAt: old.expiresAt }),
            ...closing(account, old, "replaced", now),
          ],
          { kind: "posted", id, replaced: true },
        );
        // Refused when the old ask closed after it was read, so post as new.
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
      const closed = await closeAs(account, askId, "resolved", now);
      return closed === "closed" ? "resolved" : closed;
    },

    // A repeat writes nothing, so it leaves the version alone.
    async markOpened(account, askId, now) {
      const key = keys.openAsk(account, askId);
      const open = await stored(key, storedAskSchema, now);
      if (open !== undefined && open.openedAt === undefined) {
        try {
          await write(account, [
            {
              Update: {
                TableName,
                Key: key,
                UpdateExpression: "SET openedAt = :now",
                ConditionExpression:
                  "attribute_exists(sk) AND attribute_not_exists(openedAt)",
                ExpressionAttributeValues: { ":now": now.toISOString() },
              },
            },
          ]);
          return "opened";
        } catch (error) {
          // Another call opened or closed it after it was read.
          if (!conditionFailed(error)) throw error;
        }
      }
      if (open !== undefined) return "unchanged";
      const closed = await stored(
        keys.closedAsk(account, askId),
        closedAskSchema,
        now,
      );
      return closed === undefined ? "not-found" : "unchanged";
    },

    async dismissAsk(account, askId, now) {
      const closed = await closeAs(account, askId, "dismissed", now);
      return closed === "closed"
        ? "dismissed"
        : closed === "already-closed"
          ? "unchanged"
          : "not-found";
    },

    async openAsks(account, now) {
      return listed(account, now, await meta(account));
    },

    async asksSince(account, since, now) {
      const marker = await meta(account);
      if (marker.version === since) {
        return { version: marker.version, unchanged: true };
      }
      return listed(account, now, marker);
    },

    countCall: countIn,

    rules: readRules,

    // Retried from a fresh read when another save lands first, so no
    // hashtag drops out of seen.
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
          savedAt: now.toISOString(),
          ...windowsOf(hashtags === undefined ? current.hours : hours),
          timeZone: timeZone ?? current.timeZone,
        };
        try {
          await replaceRules(account, current, next);
          return next;
        } catch (error) {
          // Another save landed after this one read the rules.
          if (!conditionFailed(error) || tries >= 4) throw error;
        }
      }
    },

    async resaveRules(account, { text, timeZone }, now) {
      for (let tries = 0; ; tries += 1) {
        const current = await readRules(account);
        if (current.text !== text || current.readFailed) return undefined;
        const next: AccountRules = {
          ...current,
          savedAt: now.toISOString(),
          timeZone: timeZone ?? current.timeZone,
        };
        try {
          await replaceRules(account, current, next);
          return next;
        } catch (error) {
          // Another save landed after this one read the rules.
          if (!conditionFailed(error) || tries >= 4) throw error;
        }
      }
    },

    async modelCapSpent(account, now) {
      const { name } = windowOf(now, rateLimits.modelCall.windowMinutes);
      const counter = await stored(
        keys.modelCount(account, name),
        counterSchema,
        now,
      );
      return (counter?.count ?? 0) >= rateLimits.modelCall.limit;
    },

    // META is read first, so the refusals after the first in a day each
    // cost a read, not a refused transaction.
    async recordModelCapReset(account, resetsAt) {
      const at = resetsAt.toISOString();
      const { modelCapResetsAt } = await meta(account);
      if (modelCapResetsAt !== undefined && modelCapResetsAt >= at) {
        return false;
      }
      try {
        await write(account, [], { modelCapResetsAt: at });
        return true;
      } catch (error) {
        // Another refusal recorded it after META was read.
        if (conditionFailed(error)) return false;
        throw error;
      }
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

    // The same rule as sortedWithRules in view.ts, from the write side. An
    // equal rules version may overwrite, as when a second job read the ask
    // before the first one's sort was stored.
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

    close() {
      db.destroy();
    },
  };
}
