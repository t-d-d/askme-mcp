// The eval set's own shape, checked in the gate. Running it against the
// model is not in the gate (repo-and-delivery.md).
import { describe, expect, it } from "vitest";
import { askTool } from "../service/src/ask";
import { parseReading } from "../service/src/rules";
import {
  attackKinds,
  cases,
  evalRules,
  type HostileCase,
  type TimingCase,
} from "./cases";

const core = cases.filter((one) => one.group === "core");
const timing = cases.filter((one): one is TimingCase => one.group === "timing");
const hostile = cases.filter(
  (one): one is HostileCase => one.group === "hostile",
);

describe("the core eval set", () => {
  it("has about 30 asks, across three areas", () => {
    expect(core.length).toBeGreaterThanOrEqual(27);
    expect(core.length).toBeLessThanOrEqual(33);
    const areas = new Set(core.map((one) => one.area));
    expect([...areas].sort()).toEqual(["family", "shop", "work"]);
    for (const area of areas) {
      expect(core.filter((one) => one.area === area).length).toBeGreaterThan(5);
    }
  });

  it("names each case once", () => {
    expect(new Set(cases.map((one) => one.name)).size).toBe(cases.length);
  });

  it.each(cases.map((one) => [one.name, one] as const))(
    "holds an ask the ask tool would take: %s",
    (_, { ask }) => {
      const parsed = askTool.input.safeParse({
        summary: ask.summary,
        area: ask.area,
        spoken_detail: ask.spokenDetail,
        ...(ask.actionLink === undefined
          ? {}
          : { action_link: ask.actionLink }),
        ...(ask.sessionLink === undefined
          ? {}
          : { session_link: ask.sessionLink }),
      });
      expect(parsed.error?.issues ?? []).toEqual([]);
    },
  );

  it("expects only hashtags the rules name", () => {
    expect(
      parseReading({ hashtags: evalRules.hashtags, hours: [] }, evalRules.text)
        ?.hashtags,
    ).toEqual(evalRules.hashtags);
    for (const { name, expected } of cases) {
      for (const set of expected.hashtags) {
        for (const hashtag of set) {
          expect(evalRules.hashtags, name).toContain(hashtag);
        }
      }
    }
  });

  it("holds the passkey ask: a session link, no action link, the machine and tab, and a hashtag that could pull it away", () => {
    const passkey = cases.find((one) => one.name === "the passkey ask");
    expect(passkey).toBeDefined();
    const { ask, expected } = passkey ?? {
      ask: undefined,
      expected: undefined,
    };
    expect(ask?.sessionLink).toBeDefined();
    expect(ask?.actionLink).toBeUndefined();
    expect(ask?.spokenDetail).toMatch(/MacBook/u);
    expect(ask?.spokenDetail).toMatch(/tab called/u);
    expect(evalRules.text).toMatch(/#admin is my own accounts/u);
    expect(expected).toEqual({ hashtags: [["shop"]], level: "normal" });
  });

  it("holds waits that run out within minutes at the level of what not acting costs, and a passkey ask that can wait (#101)", () => {
    const named = (name: string) => cases.find((one) => one.name === name);
    // The page puts an ask that lapses within the hour first (PRD, "Web
    // page"). Its level says only what it costs if the person never acts:
    // the shop keeps its old shipping rates, but the trip goes unpaid.
    expect(named("the passkey ask")?.expected.level).toBe("normal");
    expect(
      named("a sign-in code for the school's payment site")?.expected.level,
    ).toBe("high");
    expect(named("a passkey to set up when it suits")?.expected.level).toBe(
      "low",
    );
  });

  it("has rules that say nothing about when an ask is due, since the level ignores time (#101)", () => {
    expect(evalRules.text).not.toMatch(/\bdue\b|next week|later|soon/iu);
  });
});

describe("the timing group (#101)", () => {
  it("holds a few twins, across at least two areas", () => {
    expect(timing.length).toBeGreaterThanOrEqual(3);
    expect(new Set(timing.map((one) => one.area)).size).toBeGreaterThan(1);
  });

  it.each(timing.map((one) => [one.name, one] as const))(
    "expects what its core twin expects, with only the time changed: %s",
    (_, { twinOf, area, ask, expected }) => {
      const twin = core.find((one) => one.name === twinOf);
      expect(twin, twinOf).toBeDefined();
      expect(area).toBe(twin?.area);
      expect(ask.area).toBe(twin?.ask.area);
      expect(ask.summary).not.toBe(twin?.ask.summary);
      expect(expected).toEqual(twin?.expected);
    },
  );
});

describe("fitness: the eval set keeps a hostile group (untrusted-ask-text.md)", () => {
  it("has about ten asks, across the three areas", () => {
    expect(hostile.length).toBeGreaterThanOrEqual(8);
    expect(hostile.length).toBeLessThanOrEqual(15);
    expect([...new Set(hostile.map((one) => one.area))].sort()).toEqual([
      "family",
      "shop",
      "work",
    ]);
  });

  it("holds every attack ADR 12 names: rank first, use or avoid a hashtag, reveal the rules, answer in another format", () => {
    expect([...new Set(hostile.map((one) => one.attack.kind))].sort()).toEqual(
      [...attackKinds].sort(),
    );
  });

  it.each(hostile.map((one) => [one.name, one] as const))(
    "scores giving in as a miss: %s",
    (_, { attack, expected }) => {
      const { obeyed } = attack;
      if ("level" in obeyed) {
        expect(expected.level).not.toBe(obeyed.level);
      } else if ("adds" in obeyed) {
        expect(evalRules.hashtags).toContain(obeyed.adds);
        for (const set of expected.hashtags) {
          expect(set).not.toContain(obeyed.adds);
        }
      } else {
        expect(evalRules.hashtags).toContain(obeyed.drops);
        for (const set of expected.hashtags) {
          expect(set).toContain(obeyed.drops);
        }
      }
    },
  );
});
