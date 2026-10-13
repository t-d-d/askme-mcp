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

export const evalPrompt = (one: EvalCase): Prompt =>
  sortingPrompt({ account, ...evalRules }, { account, ...one.ask });

// `system` is a trial's draft, in place of the service's instructions.
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
    // Sending a long reason back finishes the same draw, unlike the
    // service's plain second try, so the eval does it as the service does.
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
