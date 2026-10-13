// One sort of one eval ask, as the service sends it, for `npm run eval` and
// `npm run eval:trial` alike: the sorter's token cap and timeout, and a reply
// whose only fault is a long reason sent back for a shorter one (#243). A
// call the provider refuses for rate is sent again after a wait (#303).
import { callerOf } from "../service/src/identity";
import {
  ModelFailed,
  type Model,
  type ModelRequest,
} from "../service/src/model";
import {
  followUpForLongReason,
  parseSortReply,
  sortingPrompt,
  type Prompt,
} from "../service/src/sort";
import { sortMaxTokens, sortTimeoutMs } from "../service/src/sorter";
import { evalRules, type EvalCase } from "./cases";
import { rateWaitMs, retryingOnRate } from "./model";
import type { Outcome } from "./score";

const account = callerOf({
  token: "eval",
  clientId: "eval",
  scopes: [],
  extra: { accountId: "user_eval", requestId: "eval" },
}).accountId;

// The prompt the service builds for an eval ask, under the eval's rules.
export const evalPrompt = (one: EvalCase): Prompt =>
  sortingPrompt({ account, ...evalRules }, { account, ...one.ask });

// One sort of an ask. A draft's instructions, when given, take the place of
// the prompt's, for a trial of a new wording. The ask and the schema stay
// the service's own.
export async function sortEvalAsk(
  client: Model,
  one: EvalCase,
  system?: string,
): Promise<Outcome> {
  const prompt = evalPrompt(one);
  const request: ModelRequest = {
    ...prompt,
    system: system ?? prompt.system,
    schemaName: "sort",
    maxTokens: sortMaxTokens,
    timeoutMs: sortTimeoutMs,
  };
  // The time the model took on the tries that got a reply. A try the
  // provider refused for rate, and the wait after it, are left out.
  let ms = 0;
  const model = retryingOnRate({
    async reply(sent) {
      const started = performance.now();
      const reply = await client.reply(sent);
      ms += performance.now() - started;
      return reply;
    },
  });
  let followedUp = false;
  try {
    let reply = await model.reply(request);
    // A reply whose only fault is a long reason goes back to the model, as
    // the service sends it. This finishes the same draw, unlike the
    // service's plain second try, so the eval sends it too.
    const followUp = followUpForLongReason(reply, evalRules.hashtags);
    if (followUp !== undefined) {
      followedUp = true;
      reply = await model.reply({ ...request, followUp });
    }
    const sort = parseSortReply(reply, evalRules.hashtags);
    return sort === undefined
      ? { one, failure: "reply-rejected", ms, followedUp }
      : { one, sort, ms, followedUp };
  } catch (error) {
    if (error instanceof ModelFailed) {
      return { one, failure: error.reason, followedUp };
    }
    throw error;
  }
}

// How long sorting the given number of asks may take, the given number at
// once: each sort timing out, and timing out again on its follow-up, with
// each call first waiting out every 429 (#303). A run that ran out of time
// would save nothing it paid for.
export const sortingTimeoutMs = (sorts: number, parallel: number): number =>
  Math.ceil(sorts / parallel) * 2 * (sortTimeoutMs + rateWaitMs) + 60_000;

// Runs a task for every item, at most `parallel` at once, and gives back
// their results in the items' order. Each worker takes the next item as soon
// as its last one is done, so one slow reply does not hold up the others.
export async function inPool<T, R>(
  items: readonly T[],
  parallel: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      const item = items[index];
      if (item !== undefined) results[index] = await task(item);
    }
  }
  await Promise.all(Array.from({ length: parallel }, worker));
  return results;
}
