import { describe, expect, it } from "vitest";
import type { AccountAsks, AccountRules, StoredAsk } from "./store/store";
import {
  asksView,
  formerHashtagsOf,
  hashtagsOf,
  rulesView,
  sortedWithRules,
  sortingMs,
  sortingUntil,
} from "./view";

const weekdays = ["mon", "tue", "wed", "thu", "fri"] as const;

// Rules never saved, as a new account has, with no time zone.
const firstRules: AccountRules = {
  text: "#work is my day job, 8 to 6 on weekdays. #shop is my online shop.",
  hashtags: ["work", "shop"],
  seen: ["old", "work", "shop"],
  version: 4,
  readFailed: false,
  hours: [{ hashtag: "work", days: [...weekdays], from: "08:00", to: "18:00" }],
};

const rules: AccountRules = {
  ...firstRules,
  savedAt: "2026-10-11T09:00:00.000Z",
  timeZone: "Europe/London",
};

const ask: StoredAsk = {
  id: "ask_1",
  summary: "Merge the fix for checkout rounding?",
  area: "The online shop",
  spokenDetail: "The fix is ready, and the tests pass.",
  postedAt: "2026-10-11T09:30:00.000Z",
  storedAt: "2026-10-11T09:30:00.000Z",
};

const sortedWith = (rulesVersion: number, hashtags = ["shop"]): StoredAsk => ({
  ...ask,
  sort: {
    hashtags,
    level: "high",
    reason: "Customers see it.",
    rulesVersion,
    sortedAt: "2026-10-11T09:31:00.000Z",
  },
});

const now = new Date("2026-10-11T09:40:00.000Z");

describe("whether an ask is sorted with the rules in force", () => {
  it("is not, before the ask is sorted", () => {
    expect(sortedWithRules(ask, rules)).toBe(false);
  });

  it("is not, when the ask was sorted with rules saved before", () => {
    expect(sortedWithRules(sortedWith(rules.version - 1), rules)).toBe(false);
  });

  it("is, when the ask was sorted with the rules in force", () => {
    expect(sortedWithRules(sortedWith(rules.version), rules)).toBe(true);
  });

  it("is, when the ask was sorted with a later version than the one read", () => {
    expect(sortedWithRules(sortedWith(rules.version + 1), rules)).toBe(true);
  });
});

describe("the hashtags as the page shows them", () => {
  it("keeps the rules' order, gives each the colour of when it first appeared, and the hours of any that have them", () => {
    expect(hashtagsOf(rules)).toEqual([
      {
        name: "work",
        colour: 1,
        hours: [{ days: [...weekdays], from: "08:00", to: "18:00" }],
      },
      { name: "shop", colour: 2 },
    ]);
  });

  it("gives no hours when the rules give none", () => {
    expect(hashtagsOf({ hashtags: ["work"], seen: ["work"] })).toEqual([
      { name: "work", colour: 0 },
    ]);
  });

  it("gives a hashtag never seen the first colour", () => {
    expect(hashtagsOf({ hashtags: ["new"], seen: ["work"] })).toEqual([
      { name: "new", colour: 0 },
    ]);
  });
});

describe("the former hashtags", () => {
  it("are the hashtags asks carry that the rules no longer name, in the order each first appeared, with its colour", () => {
    const asks = [ask, sortedWith(3, ["shop", "old"]), sortedWith(3, ["gone"])];
    expect(
      formerHashtagsOf({ ...rules, seen: ["gone", ...rules.seen] }, asks),
    ).toEqual([
      { name: "gone", colour: 0 },
      { name: "old", colour: 1 },
    ]);
  });

  it("are none when every ask carries hashtags the rules name", () => {
    expect(formerHashtagsOf(rules, [sortedWith(4), ask])).toEqual([]);
  });
});

describe("when an ask behind the rules turns stopped", () => {
  it("is half an hour after it was stored, when that was after the last save", () => {
    expect(sortingUntil(ask, rules)).toBe(
      new Date(Date.parse(ask.storedAt) + sortingMs).toISOString(),
    );
  });

  it("is half an hour after the last save, when that was after the ask was stored", () => {
    const savedAt = "2026-10-11T10:00:00.000Z";
    expect(sortingUntil(sortedWith(3), { ...rules, savedAt })).toBe(
      new Date(Date.parse(savedAt) + sortingMs).toISOString(),
    );
  });

  it("is half an hour after it was stored, when the rules were never saved", () => {
    expect(sortingUntil(ask, firstRules)).toBe(
      new Date(Date.parse(ask.storedAt) + sortingMs).toISOString(),
    );
  });

  it("is not given for an ask sorted with the rules in force", () => {
    expect(sortingUntil(sortedWith(rules.version), rules)).toBeUndefined();
  });
});

describe("the rules as the page shows them", () => {
  it("carries the text, the hashtags, whether the last reading failed, and the time zone", () => {
    expect(rulesView({ ...rules, readFailed: true })).toEqual({
      text: rules.text,
      hashtags: hashtagsOf(rules),
      readFailed: true,
      timeZone: "Europe/London",
    });
  });

  it("carries no time zone until rules are saved with one", () => {
    expect(rulesView(firstRules).timeZone).toBeUndefined();
  });
});

describe("the poll's full answer", () => {
  const found: AccountAsks = {
    version: 12,
    everAsked: true,
    asks: [
      {
        ...sortedWith(4),
        id: "ask_2",
        actionLink: "https://github.com/t-d-d/askme-mcp/pull/1",
        sessionLink: "https://claude.ai/code/session_1",
        lapsesAt: "2026-10-12T09:00:00.000Z",
        openedAt: "2026-10-11T09:35:00.000Z",
        replaces: "ask_0",
      },
      sortedWith(3, ["old"]),
    ],
  };

  it("carries the version, the hashtags, the former hashtags, the time zone, and each ask as the page shows it", () => {
    expect(asksView(found, rules, now)).toEqual({
      version: 12,
      everAsked: true,
      hashtags: hashtagsOf(rules),
      formerHashtags: [{ name: "old", colour: 0 }],
      timeZone: "Europe/London",
      asks: [
        {
          id: "ask_2",
          summary: ask.summary,
          spokenDetail: ask.spokenDetail,
          actionLink: "https://github.com/t-d-d/askme-mcp/pull/1",
          sessionLink: "https://claude.ai/code/session_1",
          postedAt: ask.postedAt,
          lapsesAt: "2026-10-12T09:00:00.000Z",
          opened: true,
          sort: {
            hashtags: ["shop"],
            level: "high",
            reason: "Customers see it.",
          },
        },
        {
          id: "ask_1",
          summary: ask.summary,
          spokenDetail: ask.spokenDetail,
          postedAt: ask.postedAt,
          opened: false,
          sortingUntil: sortingUntil(found.asks[1] ?? ask, rules),
          sort: {
            hashtags: ["old"],
            level: "high",
            reason: "Customers see it.",
          },
        },
      ],
    });
  });

  it("carries null for the sort of an ask not sorted yet", () => {
    const answer = asksView({ ...found, asks: [ask] }, rules, now);
    expect(answer.asks[0]?.sort).toBeNull();
  });

  it("carries when the cap on model calls resets while that time is ahead", () => {
    const resets = new Date(now.getTime() + 1).toISOString();
    expect(
      asksView({ ...found, modelCapResetsAt: resets }, rules, now)
        .modelCapResetsAt,
    ).toBe(resets);
  });

  it("carries none at the moment the cap resets, or after", () => {
    for (const at of [now.getTime(), now.getTime() - 1]) {
      const resets = new Date(at).toISOString();
      expect(
        asksView({ ...found, modelCapResetsAt: resets }, rules, now)
          .modelCapResetsAt,
      ).toBeUndefined();
    }
  });
});
