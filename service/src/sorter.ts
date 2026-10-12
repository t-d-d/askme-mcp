// The sort function (PRD, "Back end"): it sorts one ask after the service
// has stored it and answered, so posting never waits on the model. The ask
// tool hands it each new ask, and a poll hands it any ask still unsorted a
// while after it was posted.
//
// A sort that fails leaves the ask unsorted and is logged at warn. The ask
// is kept and shown as not sorted yet, and a later poll asks again. The
// function does not fail for it, so it alerts no one, and Lambda does not
// run it again by itself.
import { z } from "zod";
import { readEnv } from "./env";
import { jobAccount, type AccountId } from "./identity";
import { sortJobSchema } from "./jobs";
import { createLogger, errorClass, type Logger } from "./log";
import { createModel, defaultModel, ModelFailed, type Model } from "./model";
import { createKeyReader } from "./secrets";
import { parseSortReply, sortingPrompt, type Sort } from "./sort";
import { createStore, type Store } from "./store/store";

// How many times one run asks the model before it leaves the ask unsorted.
export const sortAttempts = 2;

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
  model: Model;
  log: Logger;
  now: Date;
}

// Sorts one open ask with the account's rules, unless it is already sorted
// with them, and stores the sort.
export async function sortAsk(
  account: AccountId,
  askId: string,
  { store, model, log, now }: SortContext,
): Promise<void> {
  const found = await store.askToSort(account, askId, now);
  if (found === undefined) return;
  const { ask, rules } = found;
  if (ask.sort !== undefined && ask.sort.rulesVersion >= rules.version) return;
  let sort: Sort | undefined;
  let failure = "reply-rejected";
  if (rules.text.trim() === "") {
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
    for (let tries = 0; tries < sortAttempts && sort === undefined; tries++) {
      try {
        const reply = await model.reply({
          ...prompt,
          schemaName: "sort",
          maxTokens: sortMaxTokens,
          timeoutMs: sortTimeoutMs,
        });
        sort = parseSortReply(reply, rules.hashtags);
        failure = "reply-rejected";
      } catch (error) {
        if (!(error instanceof ModelFailed)) throw error;
        failure = error.reason;
      }
    }
  }
  if (sort === undefined) {
    log.warn("sort-failed", {
      accountId: account,
      askId,
      errorClass: failure,
    });
    return;
  }
  const stored = await store.recordSort(
    account,
    askId,
    { ...sort, rulesVersion: rules.version },
    now,
  );
  if (stored) log.info("ask-sorted", { accountId: account, askId });
}

interface Services {
  store: Store;
  model: Model;
}

// Set up on the first run, so that a test can set the environment first.
let services: Services | undefined;

function ready(): Services {
  if (services === undefined) {
    const env = readEnv();
    services = {
      store: createStore({
        tableName: env.tableName,
        endpoint: env.databaseEndpoint,
      }),
      model: createModel({
        endpoint: env.modelEndpoint,
        model: defaultModel,
        key: createKeyReader({
          parameter: env.modelKeyParameter,
          endpoint: env.ssmEndpoint,
        }),
      }),
    };
  }
  return services;
}

// Lambda's context for a run, of which only its id is read.
const contextSchema = z.object({
  awsRequestId: z.string().regex(/^[\w-]{1,128}$/u),
});

export async function handler(event: unknown, context: unknown): Promise<void> {
  const log = createLogger(
    contextSchema.safeParse(context).data?.awsRequestId ?? "unknown",
  );
  try {
    const job = sortJobSchema.parse(event);
    await sortAsk(jobAccount(job.accountId), job.askId, {
      ...ready(),
      log,
      now: new Date(),
    });
  } catch (error) {
    // Anything else is askme's own fault, such as the table or the key
    // failing, so it alerts.
    log.error("request-failed", { errorClass: errorClass(error) });
  }
}
