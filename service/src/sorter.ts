// The sort function (PRD, "Back end"): it sorts one ask after the service
// has stored it and answered, so posting never waits on the model. It runs
// the jobs on the sort queue (ADR 22), which posting an ask and saving the
// rules put there, one message per run.
//
// A sort that fails leaves the ask as it was, kept and shown as not sorted
// yet or with its old hashtags. The function never fails a run for it,
// which would alert. It reports the message as failed, and the queue
// delivers it again about six minutes later. On the third delivery it logs
// the failure at warn and lets the message go, and the ask waits for the
// rules to be saved again.
//
// Each try is counted against the account's daily cap on model calls just
// before it is sent (ADR 21). Over the cap, the sort sends nothing and
// leaves the ask as it was. The function logs it at info, as the cap is
// working as designed, and lets the message go: a job held on the queue
// would come round again before the cap resets (ADR 22).
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

// How many times one run asks the model before it leaves the ask unsorted.
export const sortAttempts = 2;

// How many times the queue delivers one job before the function lets it go.
export const sortDeliveries = 3;

// How long one try may take. The function's timeout leaves room for both.
// The eval sends this too.
export const sortTimeoutMs = 20_000;

// Room for the reply: a few hashtags, a level and one line. The eval sends
// this too.
export const sortMaxTokens = 300;

// The sort an ask gets while the rules are empty: no hashtags, so it is
// simply listed (PRD, "Rules"), and no model call to make one.
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

// What became of a sort: done, as the ask is sorted with the rules in force,
// already was, or has closed; capped, as the account's daily cap on model
// calls refused a try, with why the try before it failed, if one did; or
// failed, and why.
export type SortOutcome =
  "done" | { capped: true; failed?: string } | { failed: string };

// Sorts one open ask with the rules in force, unless it is already sorted
// with them, and stores the sort. A job for an ask already up to date ends
// here, before any model call.
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
    // A reply whose only fault is a long reason goes back to the model on
    // the next try, which asks for a shorter one (#243). Anything else gets
    // the first prompt again.
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
          // A try before this one failed, and will not be tried again.
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

// One message from the queue: its id, the text of its body, and how many
// times the queue has delivered it, this time included.
export interface QueueMessage {
  messageId: string;
  text: string;
  receives: number;
}

// The job a message holds, parsed by its schema, or undefined.
const jobOf = (text: string) => {
  try {
    return sortJobSchema.safeParse(JSON.parse(text)).data;
  } catch {
    return undefined;
  }
};

// Runs one delivery of a job, and says whether the queue should deliver it
// again. A failed sort, or a failure of askme's own, goes back to the queue
// until the delivery numbered sortDeliveries, which logs it at warn and lets
// it go. A later delivery, which comes only when a run crashed, is let go
// before any work. The services are set up inside, so a failure to set
// them up is reported as askme's own.
export async function runJob(
  message: QueueMessage,
  log: Logger,
  context: () => SortContext,
): Promise<boolean> {
  const job = jobOf(message.text);
  if (job === undefined) {
    // Only askme queues a job, so one it cannot read is its own fault, and
    // reading it again would not help.
    log.error("request-failed", { errorClass: "UnreadableJob" });
    return false;
  }
  const at = { accountId: job.accountId, askId: job.askId };
  if (message.receives > sortDeliveries) {
    log.warn("sort-failed", { ...at, errorClass: "deliveries-spent" });
    return false;
  }
  let outcome: SortOutcome;
  try {
    outcome = await sortAsk(jobAccount(job.accountId), job.askId, context());
  } catch (error) {
    // Anything else is askme's own fault, such as the table or the key
    // failing, so it alerts.
    log.error("request-failed", { errorClass: errorClass(error) });
    outcome = { failed: errorClass(error) };
  }
  if (outcome === "done") return false;
  if ("capped" in outcome) {
    // A try before the cap failed, and will not be tried again.
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

// Lambda's context for a run, of which only its id is read.
const contextSchema = z.object({
  awsRequestId: z.string().regex(/^[\w-]{1,128}$/u),
});

// What the queue's trigger hands a run, of which only these parts are read.
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

// What a run answers the trigger: the messages it reports as failed, which
// the queue delivers again. Every other message is deleted.
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
    // fault. With no message ids to report, the run lets them go.
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
