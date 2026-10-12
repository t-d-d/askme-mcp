// Runs the eval set against the real model, with the sorting prompt the
// service uses, and reports the scores. There is no pass mark: the run
// fails only when it cannot reach the model at all. evals/model.ts says how
// the model is reached, with or without a key.
//
// It runs the service's default model, or the models EVAL_MODELS names,
// separated by commas. `npm run eval:candidates` runs every model in
// evals/candidates.ts, sends each ask to each of them twice, and saves the
// scores in evals/scores.md, unless a model gave no fitting reply at all.
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { callerOf } from "../service/src/identity";
import { defaultModel, ModelFailed } from "../service/src/model";
import { parseSortReply, sortingPrompt } from "../service/src/sort";
import {
  sortAttempts,
  sortMaxTokens,
  sortTimeoutMs,
} from "../service/src/sorter";
import { candidates } from "./candidates";
import { cases, evalRules, type EvalCase } from "./cases";
import { clientFor, evalKey, keyLine, namedModels, proxyLine } from "./model";
import {
  modelReport,
  scoresFile,
  unanswered,
  type ModelRun,
  type Outcome,
} from "./score";

const acrossCandidates = process.env.EVAL_CANDIDATES === "1";

const models = acrossCandidates
  ? candidates
  : namedModels.length > 0
    ? namedModels
    : [defaultModel];

// How many times each model is sent the whole set. One run of a model
// varies by a few asks, as the two runs in the pull request for #11 did,
// so models are compared over two.
const rounds = acrossCandidates ? 2 : 1;

// How many asks are sent at once.
const parallel = 5;

const account = callerOf({
  token: "eval",
  clientId: "eval",
  scopes: [],
  extra: { accountId: "user_eval", requestId: "eval" },
}).accountId;

const header = [
  keyLine,
  proxyLine,
  `Rounds: each ask sent ${String(rounds)} ${rounds === 1 ? "time" : "times"} to each model`,
].join("\n");

describe("the eval set against the real model", () => {
  it("sorts every ask and reports the scores", async () => {
    const key = evalKey();
    if (acrossCandidates && namedModels.length > 0) {
      throw new Error(
        "EVAL_MODELS and npm run eval:candidates each choose the models. Use one of them.",
      );
    }
    const rules = { account, ...evalRules };

    async function runModel(model: string): Promise<ModelRun> {
      const client = clientFor(model, key);

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
