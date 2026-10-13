// The parts of `npm run eval:trial` that need no model.
import { join, parse } from "node:path";
import { z } from "zod";
import { defaultModel } from "../service/src/model";
import { sortTimeoutMs } from "../service/src/sorter";
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

export interface TrialSettings {
  // Undefined sorts under the service's own prompt.
  draft: string | undefined;
  sorts: number;
  model: string;
  name: string;
}

// Keeps one trial well inside the eval key's small spending limit.
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

// A path, not a URL, so a name with "#", "?" or "%" stays whole.
export const recordPath = (folder: string, name: string): string =>
  join(folder, `${name}.json`);

// Room for every sort at the most sorts to time out, and again on its
// follow-up. A trial that ran out of time would save nothing it paid for.
export const trialTimeoutMs = (asks: number, parallel: number): number =>
  Math.ceil((asks * mostSorts) / parallel) * 2 * sortTimeoutMs + 60_000;

const levelOf = (line: string): Level | undefined =>
  levels.find((level) => line.startsWith(`${level}: `));

// A whole-prompt draft needs a line for each level: without one, it is more
// likely level lines written another way.
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

const asksOf = (outcomes: readonly Outcome[]): EvalCase[] => [
  ...new Set(outcomes.map(({ one }) => one)),
];

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

export interface TrialSort {
  ask: string;
  group: EvalCase["group"];
  expected: EvalCase["expected"];
  knownMiss?: number;
  hashtags?: string[];
  level?: Level;
  reason?: string;
  failure?: string;
  right: boolean;
  followedUp: boolean;
}

export interface TrialRecord {
  date: string;
  model: string;
  sortsPerAsk: number;
  draft: string | null;
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
