import { describe, expect, it } from "vitest";
import type { AsksAnswer, RulesAnswer } from "../../shared/page-api";
import type { RefusalNote } from "./refusalNote";
import { rulesState, type RulesStateInput } from "./rulesState";

const now = Date.parse("2026-10-12T18:00:00.000Z");
const minute = 60_000;

const rules: RulesAnswer = {
  text: "#work is my day job.",
  hashtags: [{ name: "work", colour: 0 }],
  readFailed: false,
  timeZone: "Europe/London",
};

const list: AsksAnswer = {
  version: 1,
  everAsked: true,
  hashtags: [],
  formerHashtags: [],
  asks: [],
};

const behindUntil = (at: number): AsksAnswer["asks"][number] => ({
  id: "a",
  summary: "Renew the shop's domain?",
  spokenDetail: "The domain lapses on Friday.",
  postedAt: new Date(at - 30 * minute).toISOString(),
  opened: false,
  sortingUntil: new Date(at).toISOString(),
  sort: null,
});

const stopped: AsksAnswer = { ...list, asks: [behindUntil(now - minute)] };
const sorting: AsksAnswer = { ...list, asks: [behindUntil(now + minute)] };
const capped = (asks: AsksAnswer): AsksAnswer => ({
  ...asks,
  modelCapResetsAt: new Date(now + 60 * minute).toISOString(),
});

const failedSave: RefusalNote = {
  kind: "failed",
  words: "That didn't go through.",
};
const rateSave: RefusalNote = {
  kind: "rate",
  words: "Slow down a little. Try again in a few seconds.",
};
const capSave: RefusalNote = {
  kind: "cap",
  words: "You've reached today's limit. It resets at 1am.",
  goesAt: now + 60 * minute,
};

const polled = (
  data: AsksAnswer,
  more: Partial<RulesStateInput["listed"]> = {},
): RulesStateInput["listed"] => ({
  data,
  polledAt: now,
  serviceAhead: 0,
  receivedAt: now,
  ...more,
});

const input = (more: Partial<RulesStateInput> = {}): RulesStateInput => ({
  loaded: { data: rules, failed: false },
  listed: polled(list),
  draft: null,
  resorting: false,
  save: { pending: false, succeeded: false, submittedAt: 0, refused: null },
  ...more,
});

describe("the text in the box", () => {
  it("is empty before the rules load", () => {
    expect(
      rulesState(input({ loaded: { data: undefined, failed: false } })).text,
    ).toBe("");
  });

  it("is the rules as loaded", () => {
    expect(rulesState(input()).text).toBe(rules.text);
  });

  it("is what the person typed, once they type", () => {
    expect(rulesState(input({ draft: "#home" })).text).toBe("#home");
  });

  it("is what the person typed when they emptied the box", () => {
    expect(rulesState(input({ draft: "" })).text).toBe("");
  });

  it("is what the person typed before the rules load", () => {
    expect(
      rulesState(
        input({ loaded: { data: undefined, failed: false }, draft: "#home" }),
      ).text,
    ).toBe("#home");
  });
});

describe("whether the text changed", () => {
  it("has not with nothing typed", () => {
    expect(rulesState(input()).changed).toBe(false);
  });

  it("has once the typed text differs from the rules", () => {
    expect(rulesState(input({ draft: "#home" })).changed).toBe(true);
  });

  it("has not when the typed text is the rules again", () => {
    expect(rulesState(input({ draft: rules.text })).changed).toBe(false);
  });

  it("has not before the rules load, whatever is typed", () => {
    expect(
      rulesState(
        input({ loaded: { data: undefined, failed: false }, draft: "#home" }),
      ).changed,
    ).toBe(false);
  });
});

describe("whether Save rules is awake", () => {
  it("sleeps with the text unchanged and no ask stopped", () => {
    expect(rulesState(input()).ready).toBe(false);
  });

  it("wakes once the text changed", () => {
    expect(rulesState(input({ draft: "#home" })).ready).toBe(true);
  });

  it("wakes with the text unchanged while an ask stopped", () => {
    expect(
      rulesState(
        input({
          listed: polled(stopped),
        }),
      ).ready,
    ).toBe(true);
  });

  it("sleeps while an ask is still being sorted", () => {
    expect(
      rulesState(
        input({
          listed: polled(sorting),
        }),
      ).ready,
    ).toBe(false);
  });

  it("counts an ask stopped by the service's clock, ahead of this one", () => {
    expect(
      rulesState(
        input({
          listed: polled(sorting, { serviceAhead: 2 * minute }),
        }),
      ).ready,
    ).toBe(true);
  });

  it("sleeps with an ask stopped while today's limit is reached", () => {
    expect(
      rulesState(
        input({
          listed: polled(capped(stopped)),
        }),
      ).ready,
    ).toBe(false);
  });

  it("wakes with an ask stopped once the limit resets by the service's clock", () => {
    expect(
      rulesState(
        input({
          listed: polled(capped(stopped), { serviceAhead: 60 * minute }),
        }),
      ).ready,
    ).toBe(true);
  });

  it("wakes once the text changed while the limit is reached", () => {
    expect(
      rulesState(
        input({
          draft: "#home",
          listed: polled(capped(stopped)),
        }),
      ).ready,
    ).toBe(true);
  });

  it("sleeps before the rules load, though an ask stopped", () => {
    expect(
      rulesState(
        input({
          loaded: { data: undefined, failed: false },
          listed: polled(stopped),
        }),
      ).ready,
    ).toBe(false);
  });

  it("sleeps before the list is polled", () => {
    expect(
      rulesState(
        input({
          listed: {
            data: undefined,
            polledAt: 0,
            serviceAhead: 0,
            receivedAt: 0,
          },
        }),
      ).ready,
    ).toBe(false);
  });
});

describe("the note under Save rules", () => {
  it("says the page is not connected when the rules cannot be loaded, before all else", () => {
    expect(
      rulesState(
        input({
          loaded: { data: undefined, failed: true },
          save: {
            pending: true,
            succeeded: false,
            submittedAt: now,
            refused: failedSave,
          },
        }),
      ).note,
    ).toEqual({ kind: "notConnected" });
  });

  it("says askme is reading the rules while a save is under way", () => {
    expect(
      rulesState(
        input({
          draft: "#home",
          save: {
            pending: true,
            succeeded: false,
            submittedAt: now,
            refused: failedSave,
          },
        }),
      ).note,
    ).toEqual({ kind: "reading" });
  });

  it("says the asks are being sorted again while a save of unchanged text is under way", () => {
    expect(
      rulesState(
        input({
          resorting: true,
          listed: polled(stopped),
          save: {
            pending: true,
            succeeded: false,
            submittedAt: now - minute,
            refused: null,
          },
        }),
      ).note,
    ).toEqual({ kind: "sorting" });
  });

  it("gives a failed save's words, with Try again", () => {
    expect(
      rulesState(
        input({
          draft: "#home",
          save: {
            pending: false,
            succeeded: false,
            submittedAt: now,
            refused: failedSave,
          },
        }),
      ).note,
    ).toEqual({
      kind: "refused",
      words: "That didn't go through.",
      retry: true,
    });
  });

  it("gives a save's refusal at the rate limit, with no Try again", () => {
    expect(
      rulesState(
        input({
          draft: "#home",
          save: {
            pending: false,
            succeeded: false,
            submittedAt: now,
            refused: rateSave,
          },
        }),
      ).note,
    ).toEqual({ kind: "refused", words: rateSave.words, retry: false });
  });

  it("gives a save's refusal at today's limit, with no Try again", () => {
    expect(
      rulesState(
        input({
          draft: "#home",
          save: {
            pending: false,
            succeeded: false,
            submittedAt: now,
            refused: capSave,
          },
        }),
      ).note,
    ).toEqual({ kind: "refused", words: capSave.words, retry: false });
  });

  it("is gone once the text changed, though askme could not read the rules", () => {
    expect(
      rulesState(
        input({
          loaded: { data: { ...rules, readFailed: true }, failed: false },
          draft: "#home",
        }),
      ).note,
    ).toEqual({ kind: "none" });
  });

  it("says askme could not read the rules, with Try again", () => {
    expect(
      rulesState(
        input({
          loaded: { data: { ...rules, readFailed: true }, failed: false },
          resorting: true,
        }),
      ).note,
    ).toEqual({ kind: "readFailed" });
  });

  it("says the asks are being sorted again after a save of unchanged text", () => {
    expect(
      rulesState(
        input({
          resorting: true,
          save: {
            pending: false,
            succeeded: true,
            submittedAt: now - minute,
            refused: null,
          },
        }),
      ).note,
    ).toEqual({ kind: "sorting" });
  });

  it("says the rules are saved, with Save rules awake while an ask stopped", () => {
    expect(
      rulesState(
        input({
          listed: polled(stopped),
        }),
      ).note,
    ).toEqual({ kind: "saved" });
  });

  it("says the rules are saved, and Save rules wakes when the text changes", () => {
    expect(rulesState(input()).note).toEqual({ kind: "savedAsleep" });
  });

  it("says nothing when no rules were ever saved", () => {
    expect(
      rulesState(
        input({ loaded: { data: { ...rules, text: "" }, failed: false } }),
      ).note,
    ).toEqual({ kind: "none" });
  });

  it("says the rules are saved once empty rules are saved", () => {
    expect(
      rulesState(
        input({
          loaded: { data: { ...rules, text: "" }, failed: false },
          save: {
            pending: false,
            succeeded: true,
            submittedAt: now - minute,
            refused: null,
          },
        }),
      ).note,
    ).toEqual({ kind: "savedAsleep" });
  });

  it("says nothing before the rules load", () => {
    expect(
      rulesState(input({ loaded: { data: undefined, failed: false } })).note,
    ).toEqual({ kind: "none" });
  });
});

describe("the note after a save of unchanged text", () => {
  const savedAt = now - minute;
  const after = (
    data: AsksAnswer,
    receivedAt: number,
    pending = false,
  ): RulesStateInput =>
    input({
      resorting: true,
      listed: polled(data, { receivedAt }),
      save: {
        pending,
        succeeded: !pending,
        submittedAt: savedAt,
        refused: null,
      },
    });

  it("stands while the list polled before the save still finds an ask stopped", () => {
    expect(rulesState(after(stopped, savedAt - minute)).note).toEqual({
      kind: "sorting",
    });
  });

  it("stands while the list polled as the save was sent finds an ask stopped", () => {
    expect(rulesState(after(stopped, savedAt)).note).toEqual({
      kind: "sorting",
    });
  });

  it("goes once a poll after the save finds an ask stopped again", () => {
    expect(rulesState(after(stopped, savedAt + 1)).note).toEqual({
      kind: "saved",
    });
  });

  it("goes once a poll after the save finds the limit reached", () => {
    expect(rulesState(after(capped(list), savedAt + 1)).note).toEqual({
      kind: "savedAsleep",
    });
  });

  it("stands while a poll after the save finds every ask being sorted", () => {
    expect(rulesState(after(sorting, savedAt + 1)).note).toEqual({
      kind: "sorting",
    });
  });

  it("stands while the save is under way, whatever a poll finds", () => {
    expect(rulesState(after(stopped, savedAt + 1, true)).note).toEqual({
      kind: "sorting",
    });
  });

  it("is not there when the last save sent changed text", () => {
    expect(
      rulesState(
        input({
          save: {
            pending: false,
            succeeded: true,
            submittedAt: savedAt,
            refused: null,
          },
        }),
      ).note,
    ).toEqual({ kind: "savedAsleep" });
  });
});
