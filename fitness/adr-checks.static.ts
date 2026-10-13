// Every check a decision record names has a test of that name (ADR 9,
// "Every ADR check exists"). It runs by hand, with `npm run checks`, and
// not in the gate. A record may name checks that land with a later issue
// (the write-an-adr skill, step 6), and the record's pull request would
// fail the gate until they did. Run it when an issue lands the last check a
// record names. ADR 9 says this check blocks a merge. By the owner's
// decision on #19 it runs by hand instead.
import { describe, expect, it } from "vitest";
import {
  asNamed,
  checksIn,
  constraintHistory,
  fitnessTests,
  records,
} from "../test/records";
import { readRepoFile } from "../test/repo";

// Checks that no test answers, each with the reason. A record is not edited
// once merged (docs/adr/README.md), so a check that a later record replaces
// stays in its own table, and is listed here.
const unanswered = [
  {
    record: 6,
    check: "Real clients connect",
    reason:
      "The record's table says it runs by hand, after a deploy. The README's checklist for connecting a real agent is how.",
  },
  {
    record: 21,
    check: "A capped sort leaves the version alone",
    reason:
      "ADR 22 replaces it. The first call the cap refuses in a day records the reset through the write function, which raises the version.",
  },
];

// Checks a record repeats from an earlier record, which a test answers under
// the earlier record's constraint file.
const carried = [
  {
    record: 20,
    check: "An idle poll is one read",
    from: 18,
    reason:
      "ADR 20 says its third check is ADR 18's, in the integration tier, and stands.",
  },
];

const describeName = (check: string, file: string): string =>
  `"fitness: ${check.charAt(0).toLowerCase()}${check.slice(1)} (${file}.md)"`;

describe.runIf(process.env.ADR_CHECKS === "1")(
  "fitness: every ADR check exists (test-tiers.md)",
  () => {
    const history = constraintHistory();
    const tests = fitnessTests();
    const behind = (record: number): string[] =>
      [...history]
        .filter(([, cited]) => cited.includes(record))
        .map(([name]) => name);
    const checksOf = (record: number): string[] => {
      const path = records().find((entry) => entry.record === record)?.path;
      return path === undefined ? [] : checksIn(readRepoFile(path));
    };
    const answered = (check: string): string[] =>
      tests
        .filter(({ name }) => asNamed(name) === asNamed(check))
        .map(({ path }) => path);

    it("reads a fitness table with at least one check from every record", () => {
      expect(records().length).toBeGreaterThan(0);
      const unread: string[] = [];
      for (const { path } of records()) {
        try {
          if (checksIn(readRepoFile(path)).length === 0) {
            unread.push(`${path}: its table holds no check.`);
          }
        } catch (error) {
          unread.push(`${path}: ${String(error)}`);
        }
      }
      expect(unread).toEqual([]);
    });

    it("finds every constraint file named by at least one test", () => {
      const named = new Set(tests.map(({ constraint }) => constraint));
      expect([...history.keys()].filter((name) => !named.has(name))).toEqual(
        [],
      );
    });

    it("finds each check as a test naming a constraint file behind its record", () => {
      const missing: string[] = [];
      for (const { record, path } of records()) {
        for (const check of checksIn(readRepoFile(path))) {
          const listed = (entry: { record: number; check: string }) =>
            entry.record === record && entry.check === check;
          if (unanswered.some(listed)) continue;
          const owner = carried.find(listed)?.from ?? record;
          const files = behind(owner);
          const found = tests.some(
            ({ name, constraint }) =>
              asNamed(name) === asNamed(check) && files.includes(constraint),
          );
          if (found) continue;
          missing.push(
            files.length === 0
              ? `ADR ${String(record)}, "${check}": no constraint file names ADR ${String(owner)} in its History line.`
              : `ADR ${String(record)}, "${check}": add a test named ${files.map((file) => describeName(check, file)).join(" or ")}, or list the check in unanswered with the reason no test can answer it.`,
          );
        }
      }
      expect(missing).toEqual([]);
    });

    it("lists only checks that are in their records, and that no test answers", () => {
      for (const { record, check } of unanswered) {
        expect(
          checksOf(record),
          `ADR ${String(record)} has no check "${check}". Take it out of unanswered.`,
        ).toContain(check);
        expect(
          answered(check),
          `A test answers "${check}". Take it out of unanswered.`,
        ).toEqual([]);
      }
      for (const { record, check, from } of carried) {
        expect(
          checksOf(record),
          `ADR ${String(record)} has no check "${check}". Take it out of carried.`,
        ).toContain(check);
        expect(
          checksOf(from),
          `ADR ${String(from)} has no check "${check}" to carry. Take it out of carried.`,
        ).toContain(check);
      }
    });
  },
);
