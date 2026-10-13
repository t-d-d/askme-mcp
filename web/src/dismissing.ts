// Decides what a dismissal does next. useDismissing.ts holds the state, runs
// the timers and the sends, and turns what happens into events.
import { Refusal } from "./load";

export type DismissNote = "dismissed" | "failed";

export type Timer = "undo" | "failed";

export interface DismissState {
  dismissed: ReadonlySet<string>;
  note: DismissNote | null;
  // Dismissed but not sent yet, until its note with Undo goes.
  waiting: string | null;
  // failedTiming: the failed note's timer runs. failedAway: the failed note
  // waits for the list to show again before its timer starts.
  failedTiming: boolean;
  failedAway: boolean;
  listShown: boolean;
  // The note has focus or the pointer. Its Undo clock stops while it does.
  kept: boolean;
}

export type DismissEvent =
  | { type: "dismiss"; id: string }
  | { type: "undo" }
  | { type: "timeUp"; timer: Timer }
  | { type: "failed"; id: string; error: unknown }
  | { type: "list"; shown: boolean }
  // kept: the note has focus or the pointer. false once both have left.
  | { type: "keep"; kept: boolean }
  // Closing the page or leaving it for another site.
  | { type: "pageHidden" }
  // The page signing out.
  | { type: "unmounted" };

export type DismissEffect =
  | { type: "send"; id: string; keepalive: boolean }
  | { type: "start"; timer: Timer }
  | { type: "clear"; timer: Timer };

export interface Stepped {
  state: DismissState;
  effects: DismissEffect[];
}

export const initial = (listShown: boolean): DismissState => ({
  dismissed: new Set(),
  note: null,
  waiting: null,
  failedTiming: false,
  failedAway: false,
  listShown,
  kept: false,
});

const without = (ids: ReadonlySet<string>, id: string) => {
  const kept = new Set(ids);
  kept.delete(id);
  return kept;
};

// The note with Undo shows, so its clock runs unless the note is kept.
const undoShows = (state: DismissState): boolean =>
  state.note === "dismissed" && state.waiting !== null;

const startUndo = (state: DismissState): DismissEffect[] =>
  state.kept ? [] : [{ type: "start", timer: "undo" }];

const stopFailed = ({ state, effects }: Stepped): Stepped => ({
  state: { ...state, failedTiming: false },
  effects: [...effects, { type: "clear", timer: "failed" }],
});

const timeFailed = (stepped: Stepped): Stepped => {
  const { state, effects } = stopFailed(stepped);
  if (!state.listShown) {
    return { state: { ...state, failedAway: true }, effects };
  }
  return {
    state: { ...state, failedTiming: true },
    effects: [...effects, { type: "start", timer: "failed" }],
  };
};

// Its note goes too, so a page the browser restores from its cache shows no
// Undo for a dismissal already sent.
const sendWaiting = (stepped: Stepped, keepalive: boolean): Stepped => {
  const { state, effects } = stepped;
  if (state.waiting === null) return stepped;
  return {
    state: {
      ...state,
      waiting: null,
      note: state.note === "dismissed" ? null : state.note,
    },
    effects: [
      ...effects,
      { type: "clear", timer: "undo" },
      { type: "send", id: state.waiting, keepalive },
    ],
  };
};

export function step(state: DismissState, event: DismissEvent): Stepped {
  const unchanged: Stepped = { state, effects: [] };
  switch (event.type) {
    case "dismiss": {
      // This note takes the place of a failed note.
      const sent = stopFailed(sendWaiting(unchanged, false));
      return {
        state: {
          ...sent.state,
          dismissed: new Set(sent.state.dismissed).add(event.id),
          note: "dismissed",
          waiting: event.id,
        },
        effects: [...sent.effects, ...startUndo(sent.state)],
      };
    }
    case "undo": {
      if (state.waiting === null) return unchanged;
      return {
        state: {
          ...state,
          dismissed: without(state.dismissed, state.waiting),
          note: null,
          waiting: null,
        },
        effects: [{ type: "clear", timer: "undo" }],
      };
    }
    case "timeUp": {
      if (event.timer === "undo") return sendWaiting(unchanged, false);
      const ended = { ...state, failedTiming: false };
      if (state.waiting === null) {
        return { state: { ...ended, note: null }, effects: [] };
      }
      return {
        state: { ...ended, note: "dismissed" },
        effects: [{ type: "clear", timer: "undo" }, ...startUndo(state)],
      };
    }
    case "failed": {
      // An ask the API no longer has is gone either way.
      if (event.error instanceof Refusal && event.error.code === "not_found") {
        return unchanged;
      }
      return timeFailed({
        state: {
          ...state,
          dismissed: without(state.dismissed, event.id),
          note: "failed",
        },
        effects:
          state.waiting === null ? [] : [{ type: "clear", timer: "undo" }],
      });
    }
    case "list": {
      const listed = { ...state, listShown: event.shown };
      // A failed note's timer stops off the list and restarts in full on
      // return.
      if (!event.shown) {
        const sent = sendWaiting({ state: listed, effects: [] }, false);
        return sent.state.failedTiming ? timeFailed(sent) : sent;
      }
      if (!state.failedAway) return { state: listed, effects: [] };
      return timeFailed({
        state: { ...listed, failedAway: false },
        effects: [],
      });
    }
    case "keep": {
      const kept = { ...state, kept: event.kept };
      if (!undoShows(state)) return { state: kept, effects: [] };
      // From the full time again when both have left.
      return {
        state: kept,
        effects: [{ type: event.kept ? "clear" : "start", timer: "undo" }],
      };
    }
    case "pageHidden":
      return sendWaiting(unchanged, true);
    case "unmounted":
      return stopFailed(sendWaiting(unchanged, false));
  }
}
