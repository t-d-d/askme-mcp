// What sortAsk says of an ask already sorted with the rules in force: the
// job is done, and the model and the table's write are never reached.
import { describe, expect, it } from "vitest";
import { callerOf } from "./identity";
import { createLogger } from "./log";
import { sortAsk } from "./sorter";
import type { AccountRules, StoredAsk } from "./store/store";

const owner = callerOf({
  token: "test",
  clientId: "test",
  scopes: [],
  extra: { accountId: "user_owner", requestId: "r" },
}).accountId;

const rules: AccountRules = {
  text: "#work is my day job. #shop is my online shop.",
  hashtags: ["work", "shop"],
  seen: ["work", "shop"],
  version: 4,
  readFailed: false,
};

const sortedWith = (rulesVersion: number): StoredAsk => ({
  id: "ask_1",
  summary: "Merge the fix for checkout rounding?",
  area: "The online shop",
  spokenDetail: "The fix is ready, and the tests pass.",
  postedAt: "2026-10-11T09:30:00.000Z",
  storedAt: "2026-10-11T09:30:00.000Z",
  sort: {
    hashtags: ["work"],
    level: "low",
    reason: "Routine.",
    rulesVersion,
    sortedAt: "2026-10-11T09:31:00.000Z",
  },
});

const unreachable = () => Promise.reject(new Error("Not reached."));

const sort = (ask: StoredAsk) =>
  sortAsk(owner, ask.id, {
    store: {
      askToSort: () => Promise.resolve({ ask, rules }),
      recordSort: unreachable,
    },
    model: { forAccount: () => ({ reply: unreachable }) },
    log: createLogger("req_sort"),
    now: new Date("2026-10-11T09:32:00.000Z"),
  });

describe("a sort of an ask already sorted with the rules in force", () => {
  it("is done, with the rules it was sorted with", async () => {
    expect(await sort(sortedWith(rules.version))).toBe("done");
  });

  it("is done, sorted with a newer version than the one it read", async () => {
    expect(await sort(sortedWith(rules.version + 1))).toBe("done");
  });
});
