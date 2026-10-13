import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cases } from "./cases";
import { clientFor, evalKey, keyLine, proxyLine } from "./model";
import { evalPrompt, inPool, sortEvalAsk } from "./sorting";
import {
  draftPrompt,
  recordPath,
  trialRecord,
  trialReport,
  trialSettings,
  trialTimeoutMs,
} from "./trial";

const parallel = 8;

describe.runIf(process.env.EVAL_TRIAL === "1")(
  "a trial of a draft wording",
  () => {
    it(
      "sorts every ask several times and prints the levels each got",
      async () => {
        const settings = trialSettings(process.env);
        const [first] = cases;
        if (first === undefined) throw new Error("The eval set has no asks.");
        const current = evalPrompt(first).system;
        const system =
          settings.draft === undefined
            ? current
            : draftPrompt(current, readFileSync(settings.draft, "utf8"));
        const client = clientFor(settings.model, evalKey());
        const set = cases.flatMap((one) =>
          Array.from({ length: settings.sorts }, () => one),
        );
        const outcomes = await inPool(set, parallel, (one) =>
          sortEvalAsk(client, one, system),
        );
        const about = {
          model: settings.model,
          sorts: settings.sorts,
          draft: settings.draft,
        };
        const folder = fileURLToPath(new URL("./trials/", import.meta.url));
        mkdirSync(folder, { recursive: true });
        const saved = recordPath(folder, settings.name);
        const record = trialRecord(outcomes, {
          ...about,
          system,
          date: new Date().toISOString().slice(0, 10),
        });
        writeFileSync(saved, `${JSON.stringify(record, null, 2)}\n`);
        console.log(
          `\n${trialReport(outcomes, about)}\n\n${keyLine}\n${proxyLine}\nSaved in evals/trials/${settings.name}.json.\n`,
        );
        expect(
          outcomes.some(({ failure }) => failure === undefined),
          "No ask got a reply from the model. See the reasons above.",
        ).toBe(true);
      },
      trialTimeoutMs(cases.length, parallel),
    );
  },
);
