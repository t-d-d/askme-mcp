// Runs the reading eval against the real model, through the service's own
// call that reads the rules, and reports the scores. Like the sorting eval
// it has no pass mark: the run fails only when it cannot reach the model at
// all. evals/model.ts says how the model is reached.
import { describe, expect, it } from "vitest";
import { weekdays, type TimeWindow } from "../shared/page-api";
import {
  readRules,
  type HashtagWindow,
  type Reading,
} from "../service/src/rules";
import { hoursText, isOpen } from "../web/src/hours";
import { evalClient, setupLines } from "./model";
import { readingCases, type ReadingCase } from "./reading";

// How many sets of rules are sent at once.
const parallel = 4;

interface Outcome {
  one: ReadingCase;
  reading?: Reading;
  failure?: string;
}

const minutesInDay = 24 * 60;

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

function report(outcomes: Outcome[]): string {
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
    ...setupLines(),
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
    const client = evalClient();

    async function readOne(one: ReadingCase): Promise<Outcome> {
      const read = await readRules(one.text, client);
      return "failed" in read
        ? { one, failure: read.failed }
        : { one, reading: read };
    }

    const outcomes: Outcome[] = [];
    for (let start = 0; start < readingCases.length; start += parallel) {
      outcomes.push(
        ...(await Promise.all(
          readingCases.slice(start, start + parallel).map(readOne),
        )),
      );
    }
    console.log(
      `\n${report(outcomes)}\n\nThe service reads the rules once on each save, and the page offers to try again when it fails. The eval tries once.\n`,
    );
    // The run counts only if the model answered at all.
    expect(
      outcomes.some(
        ({ failure }) => failure === undefined || failure === "reply-rejected",
      ),
      "No set of rules got a reply from the model. See the reasons above.",
    ).toBe(true);
  });
});
