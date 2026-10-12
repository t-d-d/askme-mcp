// The eval set's own shape, checked in the gate. Running it against the
// model is not in the gate (repo-and-delivery.md).
import { describe, expect, it } from "vitest";
import { askTool } from "../service/src/ask";
import { parseReading } from "../service/src/rules";
import { cases, evalRules } from "./cases";

describe("the core eval set", () => {
  it("has about 30 asks, across three areas", () => {
    expect(cases.length).toBeGreaterThanOrEqual(27);
    expect(cases.length).toBeLessThanOrEqual(33);
    const areas = new Set(cases.map((one) => one.area));
    expect([...areas].sort()).toEqual(["family", "shop", "work"]);
    for (const area of areas) {
      expect(cases.filter((one) => one.area === area).length).toBeGreaterThan(
        5,
      );
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
      parseReading({ hashtags: evalRules.hashtags }, evalRules.text),
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
    expect(expected).toEqual({ hashtags: [["shop"]], level: "high" });
  });
});
