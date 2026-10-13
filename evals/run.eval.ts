import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultModel } from "../service/src/model";
import { reasonLimit } from "../service/src/sort";
import { sortAttempts } from "../service/src/sorter";
import { candidates } from "./candidates";
import { cases } from "./cases";
import { clientFor, evalKey, keyLine, namedModels, proxyLine } from "./model";
import { modelReport, notSaved, scoresFile, type ModelRun } from "./score";
import { inPool, sortEvalAsk } from "./sorting";

const acrossCandidates = process.env.EVAL_CANDIDATES === "1";

const models = acrossCandidates
  ? candidates
  : namedModels.length > 0
    ? namedModels
    : [defaultModel];

// One run of a model varies by a few asks, so models are compared over two.
const rounds = acrossCandidates ? 2 : 1;

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
    const why = notSaved(runs);
    if (acrossCandidates && why !== undefined) {
      console.log(`${why}\n`);
    } else if (acrossCandidates) {
      const saved = scoresFile(runs, {
        date: new Date().toISOString().slice(0, 10),
        rounds,
      });
      writeFileSync(new URL("./scores.md", import.meta.url), saved);
      console.log(`${saved}\nSaved in evals/scores.md.\n`);
    }
    expect(
      runs.some(({ outcomes }) =>
        outcomes.some(({ failure }) => failure === undefined),
      ),
      "No ask got a reply from any model. See the reasons above.",
    ).toBe(true);
  });
});
