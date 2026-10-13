import { describe, expect, it } from "vitest";
import {
  initial,
  step,
  type DismissEffect,
  type DismissEvent,
  type DismissState,
} from "./dismissing";
import { Refusal } from "./load";

const ids = (...dismissed: string[]): ReadonlySet<string> => new Set(dismissed);

// The list showing, with nothing dismissed.
const idle = initial(true);
const at = (more: Partial<DismissState>): DismissState => ({
  ...idle,
  ...more,
});

// The states the page can be in. A waits with its note and Undo. The note
// that an earlier dismissal failed shows, alone or over B, which waits with
// its time stopped. The list is away, with that note or without it.
const states: Record<string, DismissState> = {
  idle,
  waiting: at({ dismissed: ids("a"), note: "dismissed", waiting: "a" }),
  failed: at({ note: "failed", failedTiming: true }),
  holding: at({
    dismissed: ids("b"),
    note: "failed",
    waiting: "b",
    failedTiming: true,
  }),
  away: at({ listShown: false }),
  failedAway: at({ listShown: false, note: "failed", failedAway: true }),
};
const from = (name: string): DismissState => {
  const state = states[name];
  if (state === undefined) throw new Error(`No state ${name}.`);
  return state;
};

const clearUndo: DismissEffect = { type: "clear", timer: "undo" };
const startUndo: DismissEffect = { type: "start", timer: "undo" };
const clearFailed: DismissEffect = { type: "clear", timer: "failed" };
const startFailed: DismissEffect = { type: "start", timer: "failed" };
const send = (id: string, keepalive = false): DismissEffect => ({
  type: "send",
  id,
  keepalive,
});

type Case = [string, DismissState, DismissEffect[]];

const each = (event: DismissEvent, cases: Case[]) => {
  it.each(cases)("from %s", (name, state, effects) => {
    expect(step(from(name), event)).toEqual({ state, effects });
  });
  it("covers every state", () => {
    expect(cases.map(([name]) => name)).toEqual(Object.keys(states));
  });
};

describe("the state a page starts in", () => {
  it("has nothing dismissed, no note and no time running", () => {
    expect(initial(true)).toEqual({
      dismissed: ids(),
      note: null,
      waiting: null,
      failedTiming: false,
      failedAway: false,
      listShown: true,
    });
  });

  it("knows whether the list shows", () => {
    expect(initial(false).listShown).toBe(false);
  });
});

describe("dismissing C", () => {
  each({ type: "dismiss", id: "c" }, [
    [
      "idle",
      at({ dismissed: ids("c"), note: "dismissed", waiting: "c" }),
      [clearFailed, startUndo],
    ],
    [
      "waiting",
      at({ dismissed: ids("a", "c"), note: "dismissed", waiting: "c" }),
      [clearUndo, send("a"), clearFailed, startUndo],
    ],
    [
      "failed",
      at({ dismissed: ids("c"), note: "dismissed", waiting: "c" }),
      [clearFailed, startUndo],
    ],
    [
      "holding",
      at({ dismissed: ids("b", "c"), note: "dismissed", waiting: "c" }),
      [clearUndo, send("b"), clearFailed, startUndo],
    ],
    [
      "away",
      at({
        dismissed: ids("c"),
        note: "dismissed",
        waiting: "c",
        listShown: false,
      }),
      [clearFailed, startUndo],
    ],
    [
      "failedAway",
      at({
        dismissed: ids("c"),
        note: "dismissed",
        waiting: "c",
        listShown: false,
        failedAway: true,
      }),
      [clearFailed, startUndo],
    ],
  ]);
});

describe("Undo", () => {
  each({ type: "undo" }, [
    ["idle", from("idle"), []],
    ["waiting", idle, [clearUndo]],
    ["failed", from("failed"), []],
    ["holding", at({ failedTiming: true }), [clearUndo]],
    ["away", from("away"), []],
    ["failedAway", from("failedAway"), []],
  ]);
});

describe("the note with Undo running out of time", () => {
  each({ type: "timeUp", timer: "undo" }, [
    ["idle", from("idle"), []],
    ["waiting", at({ dismissed: ids("a") }), [clearUndo, send("a")]],
    ["failed", from("failed"), []],
    [
      "holding",
      at({ dismissed: ids("b"), note: "failed", failedTiming: true }),
      [clearUndo, send("b")],
    ],
    ["away", from("away"), []],
    ["failedAway", from("failedAway"), []],
  ]);
});

describe("the note that a dismissal failed going", () => {
  each({ type: "timeUp", timer: "failed" }, [
    ["idle", from("idle"), []],
    ["waiting", from("waiting"), [clearUndo, startUndo]],
    ["failed", idle, []],
    [
      "holding",
      at({ dismissed: ids("b"), note: "dismissed", waiting: "b" }),
      [clearUndo, startUndo],
    ],
    ["away", from("away"), []],
    ["failedAway", at({ listShown: false, failedAway: true }), []],
  ]);
});

describe("sending S failing", () => {
  const unavailable = new Refusal("service_unavailable", "Try again.");
  each({ type: "failed", id: "s", error: unavailable }, [
    [
      "idle",
      at({ note: "failed", failedTiming: true }),
      [clearFailed, startFailed],
    ],
    [
      "waiting",
      at({
        dismissed: ids("a"),
        note: "failed",
        waiting: "a",
        failedTiming: true,
      }),
      [clearUndo, clearFailed, startFailed],
    ],
    ["failed", from("failed"), [clearFailed, startFailed]],
    ["holding", from("holding"), [clearUndo, clearFailed, startFailed]],
    [
      "away",
      at({ note: "failed", listShown: false, failedAway: true }),
      [clearFailed],
    ],
    ["failedAway", from("failedAway"), [clearFailed]],
  ]);

  it("brings S back to the list", () => {
    const sent = at({ dismissed: ids("s", "t") });
    expect(
      step(sent, { type: "failed", id: "s", error: unavailable }).state,
    ).toEqual(at({ dismissed: ids("t"), note: "failed", failedTiming: true }));
  });

  it("counts an error that is not a refusal as a failure", () => {
    expect(
      step(idle, { type: "failed", id: "s", error: new Error("Offline.") }),
    ).toEqual({
      state: at({ note: "failed", failedTiming: true }),
      effects: [clearFailed, startFailed],
    });
  });
});

describe("sending S refused because the API no longer has it", () => {
  const notFound = new Refusal("not_found", "No ask with this id.");
  each(
    { type: "failed", id: "s", error: notFound },
    Object.entries(states).map(([name, state]): Case => [name, state, []]),
  );
});

describe("leaving the list for another screen", () => {
  each({ type: "list", shown: false }, [
    ["idle", from("away"), []],
    [
      "waiting",
      at({ dismissed: ids("a"), listShown: false }),
      [clearUndo, send("a")],
    ],
    [
      "failed",
      at({ note: "failed", listShown: false, failedAway: true }),
      [clearFailed],
    ],
    [
      "holding",
      at({
        dismissed: ids("b"),
        note: "failed",
        listShown: false,
        failedAway: true,
      }),
      [clearUndo, send("b"), clearFailed],
    ],
    ["away", from("away"), []],
    ["failedAway", from("failedAway"), []],
  ]);
});

describe("the list showing", () => {
  each({ type: "list", shown: true }, [
    ["idle", from("idle"), []],
    ["waiting", from("waiting"), []],
    ["failed", from("failed"), []],
    ["holding", from("holding"), []],
    ["away", idle, []],
    [
      "failedAway",
      at({ note: "failed", failedTiming: true }),
      [clearFailed, startFailed],
    ],
  ]);
});

describe("closing the page", () => {
  each({ type: "pageHidden" }, [
    ["idle", from("idle"), []],
    ["waiting", at({ dismissed: ids("a") }), [clearUndo, send("a", true)]],
    ["failed", from("failed"), []],
    [
      "holding",
      at({ dismissed: ids("b"), note: "failed", failedTiming: true }),
      [clearUndo, send("b", true)],
    ],
    ["away", from("away"), []],
    ["failedAway", from("failedAway"), []],
  ]);
});

describe("signing out", () => {
  each({ type: "unmounted" }, [
    ["idle", from("idle"), [clearFailed]],
    [
      "waiting",
      at({ dismissed: ids("a") }),
      [clearUndo, send("a"), clearFailed],
    ],
    ["failed", at({ note: "failed" }), [clearFailed]],
    [
      "holding",
      at({ dismissed: ids("b"), note: "failed" }),
      [clearUndo, send("b"), clearFailed],
    ],
    ["away", from("away"), [clearFailed]],
    ["failedAway", from("failedAway"), [clearFailed]],
  ]);
});
