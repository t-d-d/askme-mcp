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
      "What the poll and the rules show the page, and whether an ask is sorted with the rules in force, against their unit tests.",
    mutate: ["service/src/view.ts"],
    tests: ["service/src/view.test.ts", "service/src/sorter.test.ts"],
  },
  sorter: {
    about:
      "How a job sorts one ask: whether it is already sorted with the rules in force, the tries, the daily cap and what goes back to the queue, against its unit tests and the sort queue's fitness test, which runs the handler.",
    mutate: ["service/src/sorter.ts"],
    tests: ["service/src/sorter.test.ts", "fitness/sort-queue.int.ts"],
  },
  refusalNote: {
    about:
      "The note a refused Save rules or Send sample asks gives, and when the cap's goes, against their unit tests.",
    mutate: ["web/src/refusalNote.ts", "web/src/resets.ts"],
    tests: ["web/src/refusalNote.test.ts", "web/src/resets.test.ts"],
  },
  rulesState: {
    about:
      "What the rules screen shows: the text, whether it changed, whether Save rules is awake, and the note, against their unit tests.",
    mutate: ["web/src/rulesState.ts"],
    tests: ["web/src/rulesState.test.ts"],
  },
  dismissing: {
    about:
      "What a dismissal does next: its note, Undo, its timers and when it is sent, against its unit tests.",
    mutate: ["web/src/dismissing.ts"],
    tests: ["web/src/dismissing.test.ts"],
  },
  rate: {
    about:
      "The rate limits' windows and the time left in one, against their unit tests.",
    mutate: ["service/src/rate.ts"],
    tests: ["service/src/rate.test.ts"],
  },
  rateLimits: {
    about:
      "The four rate limits: their windows, the store's counters, and the refusals that name a limit, against the tests that reach them (#224).",
    mutate: [
      "service/src/rate.ts",
      "service/src/store/store.ts:444-496",
      "service/src/store/store.ts:852-868",
      "service/src/store/store.ts:922-948",
      "service/src/api.ts:72-128",
      "service/src/ask.ts:167-184",
    ],
    tests: [
      "service/store.int.ts",
      "service/api.int.ts",
      "service/mcp.int.ts",
      "fitness/error-contract-codes.int.ts",
      "fitness/error-contract.int.ts",
      "fitness/polling.int.ts",
      "fitness/model-call-cap.int.ts",
      "fitness/error-contract.test.ts",
      "service/src/ask.test.ts",
      "service/src/model.test.ts",
      "service/src/samples.test.ts",
      "service/src/tools.test.ts",
      "service/src/view.test.ts",
    ],
  },
};
