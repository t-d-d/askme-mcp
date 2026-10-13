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
  view: {
    about:
      "What the poll and the rules show the page, and whether an ask is sorted with the rules in force.",
    mutate: ["service/src/view.ts", "service/src/sorter.ts:83-83"],
    tests: [
      "service/src/view.test.ts",
      "service/src/sorter-up-to-date.test.ts",
      "service/cap-reset.int.ts",
      "service/api.int.ts",
      "service/src/sorter.test.ts",
      "fitness/sort-queue.int.ts",
    ],
  },
  refusalNote: {
    about:
      "The note a refused Save rules or Send sample asks gives, and when the cap's goes, against their unit tests.",
    mutate: ["web/src/refusalNote.ts", "web/src/resets.ts"],
    tests: ["web/src/refusalNote.test.ts", "web/src/resets.test.ts"],
  },
  rate: {
    about:
      "The rate limits' windows and the time left in one, against their unit tests.",
    mutate: ["service/src/rate.ts"],
    tests: ["service/src/rate.test.ts"],
  },
  rateLimits: {
    about:
      "The four rate limits, the store's counters and the words of a refusal that names a limit (#224).",
    mutate: [
      "service/src/rate.ts",
      "service/src/wording.ts",
      "service/src/store/store.ts:430-494",
      "service/src/store/store.ts:849-849",
      "service/src/store/store.ts:903-911",
      "service/src/api.ts:73-120",
      "service/src/ask.ts:168-180",
    ],
    tests: [
      "service/src/rate.test.ts",
      "service/src/wording.test.ts",
      "service/src/limit-refusals.test.ts",
      "service/src/limit-refusals-long.test.ts",
      "service/src/ask.test.ts",
      "service/src/samples.test.ts",
      "service/src/model.test.ts",
      "service/src/tools.test.ts",
      "fitness/error-contract.test.ts",
      "service/store.int.ts",
      "service/api.int.ts",
      "service/mcp.int.ts",
      "fitness/error-contract-codes.int.ts",
      "fitness/error-contract.int.ts",
      "fitness/polling.int.ts",
      "fitness/model-call-cap.int.ts",
    ],
  },
};
