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
import { rulesFor, type EvalCase } from "./cases";
import { rateWaitMs, retryingOnRate } from "./model";
import type { Outcome } from "./score";

const account = callerOf({
  token: "eval",
  clientId: "eval",
  scopes: [],
  extra: { accountId: "user_eval", requestId: "eval" },
}).accountId;

export const evalPrompt = (one: EvalCase): Prompt =>
  sortingPrompt({ account, ...rulesFor(one) }, { account, ...one.ask });

// `system` is a trial's draft, in place of the service's instructions.
export async function sortEvalAsk(
  client: Model,
  one: EvalCase,
  system?: string,
): Promise<Outcome> {
  const prompt = evalPrompt(one);
  const { hashtags } = rulesFor(one);
  const request: ModelRequest = {
    ...prompt,
    system: system ?? prompt.system,
    schemaName: "sort",
    maxTokens: sortMaxTokens,
    timeoutMs: sortTimeoutMs,
  };
  // Only tries that got a reply count, so a 429 and the wait after it add
  // no time.
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
    // Sending a long reason back finishes the same draw, unlike the
    // service's plain second try, so the eval does it as the service does.
    const followUp = followUpForLongReason(reply, hashtags);
    if (followUp !== undefined) {
      followedUp = true;
      reply = await model.reply({ ...request, followUp });
    }
    const sort = parseSortReply(reply, hashtags);
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

// Each sort may time out, and again on its follow-up, with each call first
// waiting out every 429 at the longest wait. A run that ran out of time would
// save nothing it paid for.
export const sortingTimeoutMs = (sorts: number, parallel: number): number =>
  Math.ceil(sorts / parallel) * 2 * (sortTimeoutMs + rateWaitMs) + 60_000;

// Each worker takes the next item as soon as its last is done, so one slow
// reply does not hold up the others.
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
