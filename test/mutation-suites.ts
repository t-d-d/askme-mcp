// The suites `npm run mutate -- <suite>` runs (test/mutation.ts). Adding
// one is a data edit: the code to mutate, and the unit and integration
// tests that guard it. A refactoring ticket adds the suite for the code it
// moves, and runs it before and after the move.
import type { Suite } from "./mutation.ts";

export const suites: Record<string, Suite> = {
  rate: {
    about:
      "The rate limits' windows and the time left in one, against their unit tests.",
    mutate: ["service/src/rate.ts"],
    tests: ["service/src/rate.test.ts"],
  },
};
