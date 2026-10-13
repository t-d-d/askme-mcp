// A trial of a draft wording for the sorting prompt (#270): every eval ask
// sorted several times under the draft, and the levels each ask got.
// `npm run eval:trial` runs it. This module holds what needs no model: the
// settings, the draft, the report and the record.
import { join, parse } from "node:path";
import { z } from "zod";
import { defaultModel } from "../service/src/model";
import { levels, type Level } from "../shared/page-api";
import type { EvalCase } from "./cases";
import { modelsNamed } from "./model";
import {
  accepted,
  bothRight,
  gaveIn,
  hashtagsRight,
  knownMissMark,
  knownMissNote,
  percent,
  type Outcome,
} from "./score";
import { sortingTimeoutMs } from "./sorting";

export interface TrialSettings {
  // The draft's file, or undefined to sort under the prompt in the service.
  draft: string | undefined;
  // How many times each ask is sorted.
  sorts: number;
  model: string;
  // The name the record is saved under: the draft's file name, or "current".
  name: string;
}

// The most sorts a trial sends each ask. It keeps one trial well inside the
// eval key's small spending limit.
export const mostSorts = 20;

const envSchema = z.object({
  EVAL_DRAFT: z.string().min(1).optional(),
  EVAL_SORTS: z
    .string()
    .regex(/^\d+$/u)
    .transform(Number)
    .pipe(z.number().int().min(1).max(mostSorts))
    .optional(),
  EVAL_MODELS: z.string().optional(),
});

// The settings a trial reads from the environment.
export function trialSettings(
  env: Record<string, string | undefined>,
): TrialSettings {
  const parsed = envSchema.parse(env);
  const models = modelsNamed(parsed.EVAL_MODELS);
  if (models.length > 1) {
    throw new Error("A trial runs one model. Name one in EVAL_MODELS.");
  }
  return {
    draft: parsed.EVAL_DRAFT,
    sorts: parsed.EVAL_SORTS ?? 5,
    model: models[0] ?? defaultModel,
    name:
      parsed.EVAL_DRAFT === undefined
        ? "current"
        : parse(parsed.EVAL_DRAFT).name,
  };
}

// Where a trial's record is saved: a file named after the draft, in the
// given folder. A path, not a URL, so a name with "#", "?" or "%" stays whole.
export const recordPath = (folder: string, name: string): string =>
  join(folder, `${name}.json`);

// How long a trial may run: every sort of every ask at the most sorts, sent
// the given number at once.
export const trialTimeoutMs = (asks: number, parallel: number): number =>
  sortingTimeoutMs(asks * mostSorts, parallel);

const levelOf = (line: string): Level | undefined =>
  levels.find((level) => line.startsWith(`${level}: `));

// The prompt a draft gives. A draft whose every line starts with a level and
// a colon replaces those lines of the current prompt. Any other draft is the
// whole prompt, and needs a line for each level, as the prompt has: without
// one, it is more likely a level line written another way.
export function draftPrompt(current: string, draft: string): string {
  const text = draft.replaceAll("\r\n", "\n");
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) throw new Error("The draft is empty.");
  let prompt: string;
  if (lines.every((line) => levelOf(line) !== undefined)) {
    const replaced = current.split("\n");
    const seen = new Set<Level>();
    for (const line of lines) {
      const level = levelOf(line);
      if (level === undefined) continue;
      if (seen.has(level)) {
        throw new Error(`The draft has two lines for ${level}.`);
      }
      seen.add(level);
      const at = replaced.findIndex((old) => levelOf(old) === level);
      if (at === -1) {
        throw new Error(`The prompt has no line for ${level} to replace.`);
      }
      replaced[at] = line;
    }
    prompt = replaced.join("\n");
  } else {
    const missing = levels.filter(
      (level) => !lines.some((line) => levelOf(line) === level),
    );
    if (missing.length > 0) {
      throw new Error(
        `A draft that is not level lines alone is the whole prompt, and needs a line for each level. It has none for ${missing.join(", ")}.`,
      );
    }
    prompt = text.replace(/\n+$/u, "");
  }
  if (prompt === current) {
    throw new Error("The draft changes nothing in the prompt.");
  }
  return prompt;
}

// The asks in the order their first sort appears.
const asksOf = (outcomes: readonly Outcome[]): EvalCase[] => [
  ...new Set(outcomes.map(({ one }) => one)),
];

// The levels an ask's sorts gave, most first, each with how many of its
// sorts had other hashtags than expected, then the sorts with no fitting
// reply.
function levelsGiven(sorts: readonly Outcome[]): string {
  const given = levels
    .map((level) => {
      const at = sorts.filter(({ sort }) => sort?.level === level);
      const other = at.filter((outcome) => !hashtagsRight(outcome)).length;
      return { level, count: at.length, other };
    })
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.count - a.count)
    .map(
      ({ level, count, other }) =>
        `${level} ${String(count)}${other > 0 ? ` (${String(other)} with other hashtags)` : ""}`,
    );
  const none = sorts.filter(({ sort }) => sort === undefined).length;
  return [
    ...given,
    ...(none > 0 ? [`no fitting reply ${String(none)}`] : []),
  ].join(", ");
}

// What a trial prints: a line for each ask, with the known misses (#262)
// marked whatever levels they got, then each group's score, both as a share
// of its sorts and as the score one run of the set would expect.
export function trialReport(
  outcomes: readonly Outcome[],
  about: { model: string; sorts: number; draft: string | undefined },
): string {
  const asks = asksOf(outcomes);
  const askRows = asks.map((one) => {
    const sorts = outcomes.filter((outcome) => outcome.one === one);
    const right = sorts.filter(bothRight).length;
    return `| ${one.name}${knownMissMark(one)} | ${one.group} | ${one.expected.level} | ${String(right)}/${String(sorts.length)} | ${levelsGiven(sorts)} |`;
  });
  const groups = [...new Set(asks.map(({ group }) => group))];
  const groupRows = groups.map((group) => {
    const sorts = outcomes.filter(({ one }) => one.group === group);
    const right = sorts.filter(bothRight).length;
    const inGroup = asks.filter((one) => one.group === group).length;
    return `| ${group} | ${percent(right, sorts.length)} | ${(right / about.sorts).toFixed(1)} of ${String(inGroup)} |`;
  });
  const hostile = outcomes.filter(({ one }) => one.group === "hostile");
  return [
    `Draft: ${about.draft ?? "none, the prompt in service/src/sort.ts"}`,
    `Model: ${about.model}`,
    `Sorts: each ask ${String(about.sorts)} ${about.sorts === 1 ? "time" : "times"}`,
    "",
    "| Ask | Group | Expected | Right | Levels |",
    "| --- | --- | --- | --- | --- |",
    ...askRows,
    ...(outcomes.some(accepted)
      ? [
          "",
          `${knownMissNote} Only its level is accepted, so a sort of it with other hashtags or no fitting reply is a new miss.`,
        ]
      : []),
    "",
    "| Group | Both right | A run of the set |",
    "| --- | --- | --- |",
    ...groupRows,
    "",
    `Gave in to hostile asks: ${String(hostile.filter(gaveIn).length)} of ${String(hostile.length)}`,
  ].join("\n");
}

// One sort, as a trial's record keeps it.
export interface TrialSort {
  ask: string;
  group: EvalCase["group"];
  expected: EvalCase["expected"];
  // The issue in which the owner kept the ask's level though the default
  // model misses it, when there is one.
  knownMiss?: number;
  hashtags?: string[];
  level?: Level;
  reason?: string;
  // Why there was no fitting reply, when there was none.
  failure?: string;
  right: boolean;
  followedUp: boolean;
}

// What a trial saves, so a later session can read why an ask moved.
export interface TrialRecord {
  date: string;
  model: string;
  sortsPerAsk: number;
  draft: string | null;
  // The prompt the asks were sorted under.
  system: string;
  sorts: TrialSort[];
}

export function trialRecord(
  outcomes: readonly Outcome[],
  about: {
    model: string;
    sorts: number;
    draft: string | undefined;
    system: string;
    date: string;
  },
): TrialRecord {
  return {
    date: about.date,
    model: about.model,
    sortsPerAsk: about.sorts,
    draft: about.draft ?? null,
    system: about.system,
    sorts: outcomes.map((outcome) => {
      const { one, sort, failure } = outcome;
      return {
        ask: one.name,
        group: one.group,
        expected: one.expected,
        ...(one.knownMiss === undefined ? {} : { knownMiss: one.knownMiss }),
        ...(sort === undefined
          ? {}
          : {
              hashtags: sort.hashtags,
              level: sort.level,
              reason: sort.reason,
            }),
        ...(failure === undefined ? {} : { failure }),
        right: bothRight(outcome),
        followedUp: outcome.followedUp ?? false,
      };
    }),
  };
}
