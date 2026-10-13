import { describe, expect, it } from "vitest";
import { parseReading } from "../service/src/rules";
import { readingCases } from "./reading";

describe("the reading eval", () => {
  it("has a handful of sets of rules, each named once", () => {
    expect(readingCases.length).toBeGreaterThanOrEqual(6);
    expect(new Set(readingCases.map(({ name }) => name)).size).toBe(
      readingCases.length,
    );
  });

  it("includes rules with no hours at all", () => {
    expect(
      readingCases.some(({ expected }) => expected.hours.length === 0),
    ).toBe(true);
  });

  it.each(readingCases.map((one) => [one.name, one] as const))(
    "expects a reading askme would accept as it is: %s",
    (_, { text, expected }) => {
      expect(parseReading(expected, text)).toEqual(expected);
    },
  );
});
