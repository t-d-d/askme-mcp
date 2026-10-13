// Runs the reading eval against the real model, through the service's own
// call that reads the rules, and reports the scores. Like the sorting eval
// it has no pass mark: the run fails only when it cannot reach the model at
// all. evals/model.ts says how the model is reached.
//
// It reads with the service's default model, or with each model EVAL_MODELS
// names, once. A run across the candidates reads with the default model.
import { describe, expect, it } from "vitest";
import { weekdays, type TimeWindow } from "../shared/page-api";
import {
  readRules,
  type HashtagWindow,
  type Reading,
} from "../service/src/rules";
import { hoursText, isOpen, minutesInDay } from "../web/src/hours";
import { defaultModel } from "../service/src/model";
import {
  clientFor,
  evalKey,
  keyLine,
  namedModels,
  proxyLine,
  rateWaits,
  retryingOnRate,
} from "./model";
import { readingCases, type ReadingCase } from "./reading";

// How many sets of rules are sent at once.
const parallel = 4;

interface Outcome {
  one: ReadingCase;
  reading?: Reading;
  failure?: string;
}

// Every minute of the week, each as 1 when the windows are open then and 0
// when they are not, so two sets of windows that mean the same are equal.
const weekOf = (windows: readonly TimeWindow[]) =>
  weekdays
    .map((day) =>
      Array.from({ length: minutesInDay }, (_, minute) =>
        isOpen(windows, { day, minute }) ? "1" : "0",
      ).join(""),
    )
    .join("");

const windowsOf = (hours: readonly HashtagWindow[], name: string) =>
  hours.filter(({ hashtag }) => hashtag === name);

const hashtagsRight = ({ one, reading }: Outcome) =>
  reading?.hashtags.join(" ") === one.expected.hashtags.join(" ");

const hoursRight = ({ one, reading }: Outcome) =>
  reading !== undefined &&
  [...new Set([...one.expected.hashtags, ...reading.hashtags])].every(
    (name) =>
      weekOf(windowsOf(reading.hours, name)) ===
      weekOf(windowsOf(one.expected.hours, name)),
  );

const percent = (count: number, of: number) =>
  `${String(count)}/${String(of)} (${String(Math.round((100 * count) / of))}%)`;

// A reading in words, as the rules screen shows it.
const described = ({ hashtags, hours }: Reading) =>
  hashtags
    .map((name) => `#${name}: ${hoursText(windowsOf(hours, name)).join("; ")}`)
    .join(", ") || "no hashtags";

// The models it reads with.
const models = namedModels.length > 0 ? namedModels : [defaultModel];

function report(model: string, outcomes: Outcome[]): string {
  const n = outcomes.length;
  const misses = outcomes
    .filter((outcome) => !hashtagsRight(outcome) || !hoursRight(outcome))
    .map(({ one, reading, failure }) => {
      const got =
        reading === undefined
          ? `no fitting reply (${failure ?? "unknown"})`
          : described(reading);
      return `- ${one.name}: expected ${described(one.expected)}; got ${got}`;
    });
  return [
    `Model: ${model}`,
    "",
    "| Rules | Hashtags right | Hours right | Both right | No fitting reply |",
    "| --- | --- | --- | --- | --- |",
    `| ${String(n)} | ${percent(outcomes.filter(hashtagsRight).length, n)} | ${percent(outcomes.filter(hoursRight).length, n)} | ${percent(outcomes.filter((o) => hashtagsRight(o) && hoursRight(o)).length, n)} | ${String(outcomes.filter(({ reading }) => reading === undefined).length)} |`,
    "",
    misses.length === 0 ? "No misses." : "Misses:",
    ...misses,
  ].join("\n");
}

describe("the reading eval against the real model", () => {
  it("reads the hashtags and hours of every set of rules, and reports the scores", async () => {
    const key = evalKey();

    async function readWith(model: string): Promise<Outcome[]> {
      const client = retryingOnRate(clientFor(model, key));
      const readOne = async (one: ReadingCase): Promise<Outcome> => {
        const read = await readRules(one.text, client);
        return "failed" in read
          ? { one, failure: read.failed }
          : { one, reading: read };
      };
      const outcomes: Outcome[] = [];
      for (let start = 0; start < readingCases.length; start += parallel) {
        outcomes.push(
          ...(await Promise.all(
            readingCases.slice(start, start + parallel).map(readOne),
          )),
        );
      }
      return outcomes;
    }

    const runs = await Promise.all(models.map(readWith));
    runs.forEach((outcomes, place) => {
      console.log(`\n${report(models[place] ?? "", outcomes)}\n`);
    });
    console.log(
      `${keyLine}\n${proxyLine}\n\nThe service reads the rules once on each save, and the page offers to try again when it fails. The eval tries once. When the provider refuses a call for rate, with a 429, the eval waits and sends it again, up to ${String(rateWaits.length)} times, since the model never saw it.\n`,
    );
    // The run counts only if a model answered at all.
    expect(
      runs.some((outcomes) =>
        outcomes.some(
          ({ failure }) =>
            failure === undefined || failure === "reply-rejected",
        ),
      ),
      "No set of rules got a reply from any model. See the reasons above.",
    ).toBe(true);
  });
});
