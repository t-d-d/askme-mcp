// Runs the eval set against the real model, with the sorting prompt the
// service uses, and reports the scores. There is no pass mark: the run
// fails only when it cannot reach the model at all.
//
// On a laptop it sends the eval key from OPENROUTER_API_KEY. In a Claude
// cloud session it sends no key: the key is a network secret, added to
// requests for openrouter.ai after they leave the session, through the
// session's proxy. `npm run eval` sets NODE_USE_ENV_PROXY=1, so Node's own
// fetch goes through that proxy.
//
// EVAL_MODEL picks another model than the default.
import { describe, expect, it } from "vitest";
import { callerOf } from "../service/src/identity";
import {
  createModel,
  defaultModel,
  ModelFailed,
  openRouterEndpoint,
} from "../service/src/model";
import { parseSortReply, sortingPrompt, type Sort } from "../service/src/sort";
import {
  sortAttempts,
  sortMaxTokens,
  sortTimeoutMs,
} from "../service/src/sorter";
import { cases, evalRules, type EvalCase } from "./cases";

const env = process.env;
const cloud = env.CLAUDE_CODE_REMOTE === "true";
const model = env.EVAL_MODEL ?? defaultModel;

// How many asks are sent at once.
const parallel = 5;

const proxy = [env.HTTPS_PROXY, env.https_proxy, env.HTTP_PROXY, env.http_proxy]
  .filter((value) => value !== undefined && value !== "")
  .at(0);

// Node routes fetch through HTTPS_PROXY only with NODE_USE_ENV_PROXY=1, from
// 22.21 on the 22 line and from 24.0.
function nodeUsesProxy(): boolean {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  const supported = major === 22 ? minor >= 21 : major >= 24;
  return supported && env.NODE_USE_ENV_PROXY === "1";
}

const account = callerOf({
  token: "eval",
  clientId: "eval",
  scopes: [],
  extra: { accountId: "user_eval", requestId: "eval" },
}).accountId;

interface Outcome {
  one: EvalCase;
  sort?: Sort;
  failure?: string;
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((name) => b.includes(name));

const hashtagsRight = ({ one, sort }: Outcome) =>
  sort !== undefined &&
  one.expected.hashtags.some((set) => sameSet(set, sort.hashtags));

const levelRight = ({ one, sort }: Outcome) =>
  sort !== undefined && sort.level === one.expected.level;

const percent = (count: number, of: number) =>
  `${String(count)}/${String(of)} (${String(Math.round((100 * count) / of))}%)`;

function report(outcomes: Outcome[]): string {
  const groups = [...new Set(outcomes.map(({ one }) => one.group))];
  const rows = groups.map((group) => {
    const inGroup = outcomes.filter(({ one }) => one.group === group);
    const n = inGroup.length;
    return `| ${group} | ${String(n)} | ${percent(inGroup.filter(hashtagsRight).length, n)} | ${percent(inGroup.filter(levelRight).length, n)} | ${percent(inGroup.filter((o) => hashtagsRight(o) && levelRight(o)).length, n)} | ${String(inGroup.filter(({ sort }) => sort === undefined).length)} |`;
  });
  const misses = outcomes
    .filter((outcome) => !hashtagsRight(outcome) || !levelRight(outcome))
    .map(({ one, sort, failure }) => {
      const expected = `${one.expected.hashtags.map((set) => set.map((h) => `#${h}`).join(" ") || "none").join(" or ")}, ${one.expected.level}`;
      const got =
        sort === undefined
          ? `no fitting reply (${failure ?? "unknown"})`
          : `${sort.hashtags.map((h) => `#${h}`).join(" ") || "none"}, ${sort.level}: "${sort.reason}"`;
      return `- ${one.name}: expected ${expected}; got ${got}`;
    });
  return [
    `Model: ${model}`,
    `Key: ${cloud ? "none sent, as in a Claude cloud session, where the proxy adds it" : "OPENROUTER_API_KEY"}`,
    `Proxy: ${proxy === undefined ? "none" : `fetch goes through the proxy in HTTPS_PROXY (Node ${process.versions.node}, NODE_USE_ENV_PROXY=1)`}`,
    `Replies from the model: ${String(outcomes.filter(({ failure }) => failure === undefined || failure === "reply-rejected").length)} of ${String(outcomes.length)}`,
    "",
    "| Group | Asks | Hashtags right | Level right | Both right | No fitting reply |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    misses.length === 0 ? "No misses." : "Misses:",
    ...misses,
  ].join("\n");
}

describe("the eval set against the real model", () => {
  it("sorts every ask and reports the scores", async () => {
    const key = cloud ? undefined : env.OPENROUTER_API_KEY;
    if (!cloud && (key === undefined || key === "")) {
      throw new Error(
        "Set OPENROUTER_API_KEY to the eval key, or run the eval in a Claude cloud session, where the key is added for you.",
      );
    }
    if (proxy !== undefined && !nodeUsesProxy()) {
      throw new Error(
        `A proxy is set, but this Node (${process.versions.node}) will not send fetch through it. Run the eval with npm run eval, on Node 22.21 or later.`,
      );
    }
    const client = createModel({
      endpoint: openRouterEndpoint,
      model,
      key: () => Promise.resolve(key),
    });
    const rules = { account, ...evalRules };

    async function sortOne(one: EvalCase): Promise<Outcome> {
      const prompt = sortingPrompt(rules, { account, ...one.ask });
      try {
        const reply = await client.reply({
          ...prompt,
          schemaName: "sort",
          maxTokens: sortMaxTokens,
          timeoutMs: sortTimeoutMs,
        });
        const sort = parseSortReply(reply, evalRules.hashtags);
        return sort === undefined
          ? { one, failure: "reply-rejected" }
          : { one, sort };
      } catch (error) {
        if (error instanceof ModelFailed) return { one, failure: error.reason };
        throw error;
      }
    }

    const outcomes: Outcome[] = [];
    for (let start = 0; start < cases.length; start += parallel) {
      outcomes.push(
        ...(await Promise.all(
          cases.slice(start, start + parallel).map(sortOne),
        )),
      );
    }
    console.log(
      `\n${report(outcomes)}\n\nThe service tries each ask up to ${String(sortAttempts)} times. The eval tries once, to measure the model.\n`,
    );
    // The run counts only if the model answered at all.
    expect(
      outcomes.some(({ failure }) => failure === undefined),
      "No ask got a reply from the model. See the reasons above.",
    ).toBe(true);
  });
});
