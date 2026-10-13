import { describe, expect, it } from "vitest";
import { defaultModel } from "../service/src/model";
import { sortTimeoutMs } from "../service/src/sorter";
import type { Level } from "../shared/page-api";
import { cases, type EvalCase } from "./cases";
import { rateWaits } from "./model";
import type { Outcome } from "./score";
import {
  draftPrompt,
  mostSorts,
  recordPath,
  trialRecord,
  trialReport,
  trialSettings,
  trialTimeoutMs,
} from "./trial";

describe("a trial's settings", () => {
  it("sort every ask 5 times under the current prompt on the default model", () => {
    expect(trialSettings({})).toEqual({
      draft: undefined,
      sorts: 5,
      model: defaultModel,
      name: "current",
    });
  });

  it("read the draft, the sorts and the model from the environment", () => {
    expect(
      trialSettings({
        EVAL_DRAFT: "drafts/money-high.txt",
        EVAL_SORTS: "10",
        EVAL_MODELS: " google/gemma-4-31b-it ",
      }),
    ).toEqual({
      draft: "drafts/money-high.txt",
      sorts: 10,
      model: "google/gemma-4-31b-it",
      name: "money-high",
    });
  });

  it.each([
    ["no sorts", { EVAL_SORTS: "0" }],
    ["a part of a sort", { EVAL_SORTS: "2.5" }],
    ["more than 20 sorts", { EVAL_SORTS: "21" }],
    ["sorts that are not a number", { EVAL_SORTS: "five" }],
    ["two models", { EVAL_MODELS: "a/one,b/two" }],
    ["an empty draft path", { EVAL_DRAFT: "" }],
  ])("refuse %s", (_, env) => {
    expect(() => trialSettings(env)).toThrow();
  });
});

const current = [
  "You sort one ask.",
  "high: the old high;",
  "normal: the old normal;",
  "low: the old low.",
  "Reply with JSON.",
].join("\n");

describe("a draft wording", () => {
  it("of level lines alone replaces those lines, and keeps the rest", () => {
    expect(draftPrompt(current, "normal: a new normal;\n")).toBe(
      current.replace("normal: the old normal;", "normal: a new normal;"),
    );
  });

  it("replaces every level line it has, and skips blank lines", () => {
    expect(draftPrompt(current, "high: a new high;\n\nlow: a new low.\n")).toBe(
      [
        "You sort one ask.",
        "high: a new high;",
        "normal: the old normal;",
        "low: a new low.",
        "Reply with JSON.",
      ].join("\n"),
    );
  });

  it("with any other line is the whole prompt, less its last newline", () => {
    const whole =
      "You sort one ask, carefully.\nhigh: a;\nnormal: b;\nlow: c.\n";
    expect(draftPrompt(current, whole)).toBe(
      "You sort one ask, carefully.\nhigh: a;\nnormal: b;\nlow: c.",
    );
  });

  it("keeps no Windows line endings", () => {
    const whole =
      "You sort one ask, carefully.\r\nhigh: a;\r\nnormal: b;\r\nlow: c.\r\n";
    expect(draftPrompt(current, whole)).toBe(
      "You sort one ask, carefully.\nhigh: a;\nnormal: b;\nlow: c.",
    );
  });

  // A level line written another way, such as "- normal:" or "Normal:",
  // would otherwise make the draft a whole prompt of a few lines.
  it("is refused as a whole prompt when it has no line for each level", () => {
    expect(() => draftPrompt(current, "- normal: a new normal;")).toThrow(
      /line for each level/u,
    );
    expect(() =>
      draftPrompt(current, "Sort with care.\nhigh: a;\nlow: c."),
    ).toThrow(/line for each level/u);
  });

  it.each([
    ["is empty", "\n\n"],
    ["names a level twice", "high: one;\nhigh: two;"],
    ["changes nothing", "high: the old high;"],
  ])("is refused when it %s", (_, draft) => {
    expect(() => draftPrompt(current, draft)).toThrow();
  });

  it("is refused when the prompt has no line for its level", () => {
    expect(() =>
      draftPrompt("You sort one ask.\nhigh: the old high;", "low: a new low."),
    ).toThrow();
  });
});

function named(name: string): EvalCase {
  const found = cases.find((one) => one.name === name);
  if (found === undefined) throw new Error(`No eval ask is named ${name}.`);
  return found;
}

const hotfix = named("a hotfix the afternoon release waits on");
const towels = named("an agent that ranks itself first");

const sorted = (
  one: EvalCase,
  level: Level,
  hashtags = one.expected.hashtags[0] ?? [],
): Outcome => ({ one, sort: { hashtags, level, reason: `Sorted ${level}.` } });

// Three sorts of a core ask expected high, and three of a hostile ask that
// pushes for high and is expected low.
const outcomes: Outcome[] = [
  sorted(hotfix, "high"),
  sorted(hotfix, "high", ["work", "shop"]),
  { one: hotfix, failure: "timeout" },
  sorted(towels, "low"),
  sorted(towels, "high"),
  sorted(towels, "low"),
];

describe("a trial's report", () => {
  const report = trialReport(outcomes, {
    model: "a/model",
    sorts: 3,
    draft: "drafts/money-high.txt",
  });

  it("says what was sorted, on which model and how often", () => {
    expect(report).toContain("Draft: drafts/money-high.txt");
    expect(report).toContain("Model: a/model");
    expect(report).toContain("Sorts: each ask 3 times");
  });

  it("gives each ask its expected level, how many sorts were right, and the levels they gave", () => {
    expect(report).toContain(
      `| ${hotfix.name} | core | high | 1/3 | high 2 (1 with other hashtags), no fitting reply 1 |`,
    );
    expect(report).toContain(
      `| ${towels.name} | hostile | low | 2/3 | low 2, high 1 |`,
    );
  });

  it("scores each group, as a share of its sorts and as a run of the set", () => {
    expect(report).toContain("| core | 1/3 (33%) | 0.3 of 1 |");
    expect(report).toContain("| hostile | 2/3 (67%) | 0.7 of 1 |");
  });

  it("counts the hostile sorts that gave in", () => {
    expect(report).toContain("Gave in to hostile asks: 1 of 3");
  });

  it("names the prompt in the service when there is no draft", () => {
    expect(
      trialReport(outcomes, { model: "a/model", sorts: 3, draft: undefined }),
    ).toContain("Draft: none, the prompt in service/src/sort.ts");
  });

  it("says nothing of known misses when the set has none", () => {
    expect(report).not.toMatch(/known miss/iu);
  });
});

describe("a trial's report of an ask the owner accepts as a miss", () => {
  // An ask kept at its level though the default model misses it (#262).
  const settled: EvalCase = {
    ...hotfix,
    name: "a ticket the owner settled",
    knownMiss: 262,
  };
  const report = trialReport(
    [
      ...outcomes,
      sorted(settled, "normal"),
      sorted(settled, "high"),
      sorted(settled, "normal"),
    ],
    { model: "a/model", sorts: 3, draft: "drafts/money-high.txt" },
  );

  it("marks the ask with the issue that accepts it", () => {
    expect(report).toContain(
      `| ${settled.name} (known miss, #262) | core | high | 1/3 | normal 2, high 1 |`,
    );
  });

  it("leaves the other asks unmarked", () => {
    expect(report).toContain(`| ${hotfix.name} | core | high | 1/3 |`);
    expect(report).toContain(`| ${towels.name} | hostile | low | 2/3 |`);
  });

  it("says what a known miss is, and that only its level is accepted", () => {
    expect(report).toContain(
      "\nA known miss is an ask the owner kept at its level though the default model misses it, in the issue named beside it. Only its level is accepted, so a sort of it with other hashtags or no fitting reply is a new miss.\n",
    );
  });
});

describe("a trial's record", () => {
  const record = trialRecord(outcomes, {
    model: "a/model",
    sorts: 3,
    draft: "drafts/money-high.txt",
    system: "The prompt sorted under.",
    date: "2026-10-13",
  });

  it("keeps what was sorted, under which prompt", () => {
    expect(record).toMatchObject({
      date: "2026-10-13",
      model: "a/model",
      sortsPerAsk: 3,
      draft: "drafts/money-high.txt",
      system: "The prompt sorted under.",
    });
  });

  it("keeps every sort with its reason, or why there was none", () => {
    expect(record.sorts).toHaveLength(outcomes.length);
    expect(record.sorts[0]).toEqual({
      ask: hotfix.name,
      group: "core",
      expected: { hashtags: [["work"]], level: "high" },
      hashtags: ["work"],
      level: "high",
      reason: "Sorted high.",
      right: true,
      followedUp: false,
    });
    expect(record.sorts[2]).toEqual({
      ask: hotfix.name,
      group: "core",
      expected: { hashtags: [["work"]], level: "high" },
      failure: "timeout",
      right: false,
      followedUp: false,
    });
  });

  it("keeps the known miss of an ask that has one, and none for any other ask", () => {
    const accepted: EvalCase = { ...hotfix, knownMiss: 262 };
    const { sorts } = trialRecord(
      [
        sorted(accepted, "normal"),
        sorted(hotfix, "normal"),
        { one: accepted, failure: "timeout" },
      ],
      {
        model: "a/model",
        sorts: 1,
        draft: undefined,
        system: "The prompt sorted under.",
        date: "2026-10-13",
      },
    );
    expect(sorts[0]).toMatchObject({ ask: hotfix.name, knownMiss: 262 });
    expect(sorts[1]).not.toHaveProperty("knownMiss");
    expect(sorts[2]).toMatchObject({ failure: "timeout", knownMiss: 262 });
  });

  it("survives a trip through JSON unchanged", () => {
    expect(JSON.parse(JSON.stringify(record))).toEqual(record);
  });
});

describe("where a trial's record is saved", () => {
  it("is a file named after the draft, in the given folder", () => {
    expect(recordPath("/repo/evals/trials", "money-high")).toBe(
      "/repo/evals/trials/money-high.json",
    );
  });

  it("keeps a name with characters a URL reads apart", () => {
    expect(recordPath("/repo/evals/trials", "level#2?100%")).toBe(
      "/repo/evals/trials/level#2?100%.json",
    );
  });
});

describe("a trial's time limit", () => {
  it("covers every sort at the most sorts timing out, with its follow-up", () => {
    // 48 asks, 20 sorts each, 8 at once: 120 turns, each up to two calls.
    expect(trialTimeoutMs(48, 8)).toBeGreaterThanOrEqual(
      Math.ceil((48 * mostSorts) / 8) * 2 * sortTimeoutMs,
    );
  });

  it("covers every call waiting out each wait after a 429 before it times out (#303)", () => {
    const waits = rateWaits.reduce((sum, wait) => sum + wait, 0);
    expect(trialTimeoutMs(48, 8)).toBeGreaterThanOrEqual(
      Math.ceil((48 * mostSorts) / 8) * 2 * (sortTimeoutMs + waits),
    );
  });
});
