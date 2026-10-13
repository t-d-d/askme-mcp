// The sort function, which runs the jobs on the sort queue (ADR 22).
import { z } from "zod";
import { readEnv } from "./env";
import { jobAccount, type AccountId } from "./identity";
import { sortJobSchema } from "./jobs";
import { createLogger, errorClass, type Logger } from "./log";
import {
  CapReached,
  createCountedModel,
  defaultModel,
  ModelFailed,
  type CountedModel,
  type FollowUp,
  type ModelRequest,
} from "./model";
import { emptyRules } from "./rules";
import { createKeyReader } from "./secrets";
import {
  followUpForLongReason,
  parseSortReply,
  sortingPrompt,
  type Sort,
} from "./sort";
import { createStore, type Store } from "./store/store";
import { sortedWithRules } from "./view";

// Model tries in one run.
export const sortAttempts = 2;

// Queue deliveries of one job.
export const sortDeliveries = 3;

// The sort function's timeout in the deployment definition leaves room for
// sortAttempts tries. The eval sends this too.
export const sortTimeoutMs = 20_000;

// Room for a few hashtags, a level and one line. The eval sends this too.
export const sortMaxTokens = 300;

export const emptyRulesSort: Sort = {
  hashtags: [],
  level: "normal",
  reason: "There are no rules yet, so askme lists this ask without sorting it.",
};

export interface SortContext {
  store: Pick<Store, "askToSort" | "recordSort">;
  model: Pick<CountedModel, "forAccount">;
  log: Logger;
  now: Date;
}

// With capped, failed is why the try before the cap failed, if one did.
export type SortOutcome =
  "done" | { capped: true; failed?: string } | { failed: string };

export async function sortAsk(
  account: AccountId,
  askId: string,
  { store, model, log, now }: SortContext,
): Promise<SortOutcome> {
  const found = await store.askToSort(account, askId, now);
  if (found === undefined) return "done";
  const { ask, rules } = found;
  if (sortedWithRules(ask, rules)) return "done";
  let sort: Sort | undefined;
  let failure = "reply-rejected";
  if (emptyRules(rules.text)) {
    sort = emptyRulesSort;
  } else {
    const prompt = sortingPrompt(
      { account, text: rules.text, hashtags: rules.hashtags },
      {
        account,
        summary: ask.summary,
        area: ask.area,
        spokenDetail: ask.spokenDetail,
        actionLink: ask.actionLink,
        sessionLink: ask.sessionLink,
      },
    );
    const calls = model.forAccount(account);
    const request: ModelRequest = {
      ...prompt,
      schemaName: "sort",
      maxTokens: sortMaxTokens,
      timeoutMs: sortTimeoutMs,
    };
    let followUp: FollowUp | undefined;
    for (let tries = 0; tries < sortAttempts && sort === undefined; tries++) {
      try {
        const reply = await calls.reply(
          followUp === undefined ? request : { ...request, followUp },
        );
        sort = parseSortReply(reply, rules.hashtags);
        followUp = followUpForLongReason(reply, rules.hashtags);
        failure = "reply-rejected";
      } catch (error) {
        if (error instanceof CapReached) {
          return tries > 0
            ? { capped: true, failed: failure }
            : { capped: true };
        }
        if (!(error instanceof ModelFailed)) throw error;
        followUp = undefined;
        failure = error.reason;
      }
    }
  }
  if (sort === undefined) return { failed: failure };
  const stored = await store.recordSort(
    account,
    askId,
    { ...sort, rulesVersion: rules.version },
    now,
  );
  if (stored) log.info("ask-sorted", { accountId: account, askId });
  return "done";
}

// receives counts this delivery too.
export interface QueueMessage {
  messageId: string;
  text: string;
  receives: number;
}

const jobOf = (text: string) => {
  try {
    return sortJobSchema.safeParse(JSON.parse(text)).data;
  } catch {
    return undefined;
  }
};

// Answers whether the queue should deliver the job again. A failed sort
// never fails the run, which would alert. The services are set up inside
// the try, so a failure there is caught as askme's own.
export async function runJob(
  message: QueueMessage,
  log: Logger,
  context: () => SortContext,
): Promise<boolean> {
  const job = jobOf(message.text);
  if (job === undefined) {
    // Only askme queues a job, so this is its own fault, and a retry would
    // not help.
    log.error("request-failed", { errorClass: "UnreadableJob" });
    return false;
  }
  const at = { accountId: job.accountId, askId: job.askId };
  // Only a crashed run leads to a delivery past the last.
  if (message.receives > sortDeliveries) {
    log.warn("sort-failed", { ...at, errorClass: "deliveries-spent" });
    return false;
  }
  let outcome: SortOutcome;
  try {
    outcome = await sortAsk(jobAccount(job.accountId), job.askId, context());
  } catch (error) {
    // askme's own fault, such as the table or the key failing, so it alerts.
    log.error("request-failed", { errorClass: errorClass(error) });
    outcome = { failed: errorClass(error) };
  }
  if (outcome === "done") return false;
  if ("capped" in outcome) {
    // Let go: a retry would come round again before the cap resets
    // (ADR 22).
    if (outcome.failed !== undefined) {
      log.warn("sort-failed", { ...at, errorClass: outcome.failed });
    }
    log.info("sort-capped", at);
    return false;
  }
  if (message.receives >= sortDeliveries) {
    log.warn("sort-failed", { ...at, errorClass: outcome.failed });
    return false;
  }
  log.info("sort-retried", { ...at, errorClass: outcome.failed });
  return true;
}

interface Services {
  store: Store;
  model: CountedModel;
}

// Set up on the first run, so that a test can set the environment first.
let services: Services | undefined;

function ready(): Services {
  if (services === undefined) {
    const env = readEnv();
    const store = createStore({
      tableName: env.tableName,
      endpoint: env.databaseEndpoint,
    });
    services = {
      store,
      model: createCountedModel({
        endpoint: env.modelEndpoint,
        model: defaultModel,
        key: createKeyReader({
          parameter: env.modelKeyParameter,
          endpoint: env.ssmEndpoint,
        }),
        store,
      }),
    };
  }
  return services;
}

const contextSchema = z.object({
  awsRequestId: z.string().regex(/^[\w-]{1,128}$/u),
});

const queueEventSchema = z.object({
  Records: z.array(
    z.object({
      messageId: z.string(),
      body: z.string(),
      attributes: z.object({
        ApproximateReceiveCount: z
          .string()
          .regex(/^[1-9]\d{0,5}$/u)
          .transform(Number),
      }),
    }),
  ),
});

// The queue delivers the listed messages again and deletes the rest.
export interface QueueAnswer {
  batchItemFailures: { itemIdentifier: string }[];
}

export async function handler(
  event: unknown,
  context: unknown,
): Promise<QueueAnswer> {
  const log = createLogger(
    contextSchema.safeParse(context).data?.awsRequestId ?? "unknown",
  );
  const parsed = queueEventSchema.safeParse(event);
  if (!parsed.success) {
    // The trigger always sends a well-formed event, so this is askme's
    // fault. With no message ids to report, the messages are let go.
    log.error("request-failed", { errorClass: "UnreadableEvent" });
    return { batchItemFailures: [] };
  }
  const failed: QueueAnswer["batchItemFailures"] = [];
  for (const record of parsed.data.Records) {
    const again = await runJob(
      {
        messageId: record.messageId,
        // eslint-disable-next-line no-restricted-syntax -- a queue message's body, which runJob parses with sortJobSchema, not a request body
        text: record.body,
        receives: record.attributes.ApproximateReceiveCount,
      },
      log,
      () => ({ ...ready(), log, now: new Date() }),
    );
    if (again) failed.push({ itemIdentifier: record.messageId });
  }
  return { batchItemFailures: failed };
}
