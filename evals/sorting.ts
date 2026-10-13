// One sort of one eval ask, as the service sends it, for `npm run eval` and
// `npm run eval:trial` alike: the sorter's token cap and timeout, and a reply
// whose only fault is a long reason sent back for a shorter one (#243).
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
  const started = performance.now();
  let followedUp = false;
  try {
    let reply = await client.reply(request);
    // A reply whose only fault is a long reason goes back to the model, as
    // the service sends it. This finishes the same draw, unlike the
    // service's plain second try, so the eval sends it too.
    const followUp = followUpForLongReason(reply, evalRules.hashtags);
    if (followUp !== undefined) {
      followedUp = true;
      reply = await client.reply({ ...request, followUp });
    }
    const ms = performance.now() - started;
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
