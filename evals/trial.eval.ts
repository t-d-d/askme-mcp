// Sorts every eval ask several times under a draft wording of the sorting
// prompt, on the real model, and prints the levels each ask got (#270). It
// runs only with `npm run eval:trial`, which sets EVAL_TRIAL, so
// `npm run eval` skips it.
//
// EVAL_DRAFT names the draft's file. A draft of level lines alone, such as
// "normal: never acting would ...", replaces those lines of the prompt in
// service/src/sort.ts. Any other draft is the whole prompt. With no draft the
// asks are sorted under the prompt as it is. EVAL_SORTS sets how many times
// each ask is sorted, 5 unless set, and EVAL_MODELS names one model in place
// of the default. Each sort and its reason is saved in evals/trials/, under
// the draft's file name.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cases } from "./cases";
import { clientFor, evalKey, keyLine, proxyLine } from "./model";
import { evalPrompt, inPool, sortEvalAsk } from "./sorting";
import { draftPrompt, trialRecord, trialReport, trialSettings } from "./trial";

// How many asks are sent at once.
const parallel = 8;

describe.runIf(process.env.EVAL_TRIAL === "1")(
  "a trial of a draft wording",
  () => {
    it("sorts every ask several times and prints the levels each got", async () => {
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
      const folder = new URL("./trials/", import.meta.url);
      mkdirSync(folder, { recursive: true });
      const saved = new URL(`${settings.name}.json`, folder);
      const record = trialRecord(outcomes, {
        ...about,
        system,
        date: new Date().toISOString().slice(0, 10),
      });
      writeFileSync(saved, `${JSON.stringify(record, null, 2)}\n`);
      console.log(
        `\n${trialReport(outcomes, about)}\n\n${keyLine}\n${proxyLine}\nSaved in evals/trials/${settings.name}.json.\n`,
      );
      // The trial counts only if the model answered at all.
      expect(
        outcomes.some(({ failure }) => failure === undefined),
        "No ask got a reply from the model. See the reasons above.",
      ).toBe(true);
    });
  },
);
