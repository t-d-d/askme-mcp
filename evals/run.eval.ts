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
// It runs the service's default model, or the models EVAL_MODELS names,
// separated by commas. `npm run eval:candidates` runs every model in
// evals/candidates.ts, sends each ask to each of them twice, and saves the
// scores in evals/scores.md, unless a model gave no fitting reply at all.
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { callerOf } from "../service/src/identity";
import {
  createModel,
  defaultModel,
  ModelFailed,
  openRouterEndpoint,
} from "../service/src/model";
import { parseSortReply, sortingPrompt } from "../service/src/sort";
import {
  sortAttempts,
  sortMaxTokens,
  sortTimeoutMs,
} from "../service/src/sorter";
import { candidates } from "./candidates";
import { cases, evalRules, type EvalCase } from "./cases";
import {
  modelReport,
  scoresFile,
  unanswered,
  type ModelRun,
  type Outcome,
} from "./score";

const env = process.env;
const cloud = env.CLAUDE_CODE_REMOTE === "true";
const acrossCandidates = env.EVAL_CANDIDATES === "1";

const named = (env.EVAL_MODELS ?? "")
  .split(",")
  .map((model) => model.trim())
  .filter((model) => model !== "");

const models = acrossCandidates
  ? candidates
  : named.length > 0
    ? named
    : [defaultModel];

// How many times each model is sent the whole set. One run of a model
// varies by a few asks, as the two runs in the pull request for #11 did,
// so models are compared over two.
const rounds = acrossCandidates ? 2 : 1;

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

const header = [
  `Key: ${cloud ? "none sent, as in a Claude cloud session, where the proxy adds it" : "OPENROUTER_API_KEY"}`,
  `Proxy: ${proxy === undefined ? "none" : `fetch goes through the proxy in HTTPS_PROXY (Node ${process.versions.node}, NODE_USE_ENV_PROXY=1)`}`,
  `Rounds: each ask sent ${String(rounds)} ${rounds === 1 ? "time" : "times"} to each model`,
].join("\n");

describe("the eval set against the real model", () => {
  it("sorts every ask and reports the scores", async () => {
    const key = cloud ? undefined : env.OPENROUTER_API_KEY;
    if (!cloud && (key === undefined || key === "")) {
      throw new Error(
        "Set OPENROUTER_API_KEY to the eval key, or run the eval in a Claude cloud session, where the key is added for you.",
      );
    }
    if (acrossCandidates && named.length > 0) {
      throw new Error(
        "EVAL_MODELS and npm run eval:candidates each choose the models. Use one of them.",
      );
    }
    if (proxy !== undefined && !nodeUsesProxy()) {
      throw new Error(
        `A proxy is set, but this Node (${process.versions.node}) will not send fetch through it. Run the eval with npm run eval, on Node 22.21 or later.`,
      );
    }
    const rules = { account, ...evalRules };

    async function runModel(model: string): Promise<ModelRun> {
      const client = createModel({
        endpoint: openRouterEndpoint,
        model,
        key: () => Promise.resolve(key),
      });

      async function sortOne(one: EvalCase): Promise<Outcome> {
        const prompt = sortingPrompt(rules, { account, ...one.ask });
        const started = performance.now();
        try {
          const reply = await client.reply({
            ...prompt,
            schemaName: "sort",
            maxTokens: sortMaxTokens,
            timeoutMs: sortTimeoutMs,
          });
          const ms = performance.now() - started;
          const sort = parseSortReply(reply, evalRules.hashtags);
          return sort === undefined
            ? { one, failure: "reply-rejected", ms }
            : { one, sort, ms };
        } catch (error) {
          if (error instanceof ModelFailed) {
            return { one, failure: error.reason };
          }
          throw error;
        }
      }

      // A pool: each worker takes the next ask as soon as its last one is
      // back, so one slow reply does not hold up the others.
      const set = Array.from({ length: rounds }, () => cases).flat();
      const outcomes: Outcome[] = new Array<Outcome>(set.length);
      let next = 0;
      async function worker(): Promise<void> {
        while (next < set.length) {
          const index = next++;
          const one = set[index];
          if (one !== undefined) outcomes[index] = await sortOne(one);
        }
      }
      await Promise.all(Array.from({ length: parallel }, worker));
      return { model, outcomes };
    }

    // The models run at once, each with its own pool, so a run across the
    // candidates fits the test's time limit.
    const runs = await Promise.all(models.map(runModel));
    for (const run of runs) console.log(`\n${modelReport(run)}\n`);
    console.log(
      `${header}\n\nThe service tries each ask up to ${String(sortAttempts)} times. The eval tries each ask once a round, to measure the model.\n`,
    );
    const silent = unanswered(runs);
    if (acrossCandidates && silent.length > 0) {
      console.log(
        `Not saved in evals/scores.md: no fitting reply came from ${silent.join(", ")}. See the reasons above.\n`,
      );
    } else if (acrossCandidates) {
      const saved = scoresFile(runs, {
        date: new Date().toISOString().slice(0, 10),
        rounds,
      });
      writeFileSync(new URL("./scores.md", import.meta.url), saved);
      console.log(`${saved}\nSaved in evals/scores.md.\n`);
    }
    // The run counts only if a model answered at all.
    expect(
      runs.some(({ outcomes }) =>
        outcomes.some(({ failure }) => failure === undefined),
      ),
      "No ask got a reply from any model. See the reasons above.",
    ).toBe(true);
  });
});
