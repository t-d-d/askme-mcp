// The suites `npm run mutate -- <suite>` runs (test/mutation.ts). Adding
// one is a data edit: the code to mutate, and the unit and integration
// tests that guard it. A refactoring ticket adds the suite for the code it
// moves, and runs it before and after the move.
import type { Suite } from "./mutation.ts";

export const suites: Record<string, Suite> = {
  listView: {
    about:
      "What the main screen's list shows, against its unit tests and its parts'.",
    mutate: ["web/src/listView.ts"],
    tests: [
      "web/src/listView.test.ts",
      "web/src/hours.test.ts",
      "web/src/waiting.test.ts",
      "web/src/tab.test.ts",
      "web/src/sorting.test.ts",
    ],
  },
  refusalNote: {
    about:
      "The note a refused Save rules or Send sample asks gives, and when the cap's goes, against their unit tests.",
    mutate: ["web/src/refusalNote.ts", "web/src/resets.ts"],
    tests: [
      "web/src/refusalNote.test.ts",
      "web/src/resets.test.ts",
      "web/src/load.test.ts",
    ],
  },
  rate: {
    about:
      "The rate limits' windows and the time left in one, against their unit tests.",
    mutate: ["service/src/rate.ts"],
    tests: ["service/src/rate.test.ts"],
  },
};
