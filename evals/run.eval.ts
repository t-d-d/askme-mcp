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
import { defaultModel } from "../service/src/model";
import { reasonLimit } from "../service/src/sort";
import { sortAttempts } from "../service/src/sorter";
import { candidates } from "./candidates";
import { cases } from "./cases";
import { clientFor, evalKey, keyLine, namedModels, proxyLine } from "./model";
import { modelReport, scoresFile, unanswered, type ModelRun } from "./score";
import { inPool, sortEvalAsk } from "./sorting";

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

    async function runModel(model: string): Promise<ModelRun> {
      const client = clientFor(model, key);
      const set = Array.from({ length: rounds }, () => cases).flat();
      const outcomes = await inPool(set, parallel, (one) =>
        sortEvalAsk(client, one),
      );
      return { model, outcomes };
    }

    // The models run at once, each with its own pool, so a run across the
    // candidates fits the test's time limit.
    const runs = await Promise.all(models.map(runModel));
    for (const run of runs) console.log(`\n${modelReport(run)}\n`);
    console.log(
      `${header}\n\nThe service tries each ask up to ${String(sortAttempts)} times. The eval tries each ask once a round, to measure the model, and leaves out the service's plain second try, which is a second draw. When a reply's only fault is a reason over ${String(reasonLimit)} characters, the eval sends it back for a shorter one, as the service does, since that finishes the same draw.\n`,
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
