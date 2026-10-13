// What a dismissal does next (docs/design.md, "The open card"), as a step
// from one state and one event to the next state and the effects to run.
// useDismissing.ts holds the state, runs the timers and the sends, and
// turns what happens into events. Everything it decides is here.
//
// The ask goes from the list at once, and a note with Undo shows for a few
// seconds. The dismissal is sent when the note goes. If it fails, the ask
// comes back with a note that says so.
//
// One dismissal waits at a time. Dismissing another sends the waiting one
// at once, and so does leaving the list or closing the page. If an earlier
// dismissal fails while one waits, the note that says so shows first, and
// the waiting one's time stops. When that note goes, the note with Undo
// comes back for its full time.
//
// The page keeps its dismissals while another screen shows. A dismissal
// sent as the list goes that fails brings the ask back. The note that a
// dismissal failed keeps its time only while the list shows. Leaving the
// list stops it, and the note gets its full time when the list shows again.
import { Refusal } from "./load";

export type DismissNote = "dismissed" | "failed";

// The note with Undo, and the note that a dismissal failed. Each runs for
// the note's full time when started.
export type Timer = "undo" | "failed";

export interface DismissState {
  // The asks dismissed on this page, which the list leaves out.
  dismissed: ReadonlySet<string>;
  note: DismissNote | null;
  // The dismissal waiting for its note to go.
  waiting: string | null;
  // Whether the time of the note that a dismissal failed runs, and whether
  // that note waits for the list to show again to get its time.
  failedTiming: boolean;
  failedAway: boolean;
  listShown: boolean;
}

export type DismissEvent =
  | { type: "dismiss"; id: string }
  | { type: "undo" }
  | { type: "timeUp"; timer: Timer }
  // Sending a dismissal failed.
  | { type: "failed"; id: string; error: unknown }
  // The list showing, or leaving it for another screen.
  | { type: "list"; shown: boolean }
  // Closing the page or leaving it for another site.
  | { type: "pageHidden" }
  // The page signing out, which takes the dismissals with it.
  | { type: "unmounted" };

// Sending a dismissal, kept alive past the page when the page is closing,
// and starting or clearing a timer.
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
});

const without = (ids: ReadonlySet<string>, id: string) => {
  const kept = new Set(ids);
  kept.delete(id);
  return kept;
};

// Stops the time of the note that a dismissal failed.
const stopFailed = ({ state, effects }: Stepped): Stepped => ({
  state: { ...state, failedTiming: false },
  effects: [...effects, { type: "clear", timer: "failed" }],
});

// Gives the note that a dismissal failed its full time, from now if the
// list shows, or else from when it shows again.
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

// Sends the waiting dismissal now, if there is one, and its note goes, so
// a page kept by the browser comes back with no Undo for it.
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
      // This note takes the place of one that an earlier dismissal failed.
      const sent = stopFailed(sendWaiting(unchanged, false));
      return {
        state: {
          ...sent.state,
          dismissed: new Set(sent.state.dismissed).add(event.id),
          note: "dismissed",
          waiting: event.id,
        },
        effects: [...sent.effects, { type: "start", timer: "undo" }],
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
      // When the note that a dismissal failed goes, a dismissal still
      // waiting gets its note with Undo back for its full time.
      const ended = { ...state, failedTiming: false };
      if (state.waiting === null) {
        return { state: { ...ended, note: null }, effects: [] };
      }
      return {
        state: { ...ended, note: "dismissed" },
        effects: [
          { type: "clear", timer: "undo" },
          { type: "start", timer: "undo" },
        ],
      };
    }
    case "failed": {
      // An ask the API no longer has is gone either way.
      if (event.error instanceof Refusal && event.error.code === "not_found") {
        return unchanged;
      }
      // A dismissal still waiting stops its time while this note shows, and
      // its note with Undo comes back when this one goes.
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
      // Leaving the list sends the waiting dismissal at once, and stops the
      // time of a note that a dismissal failed. That note gets its full
      // time as the list shows again.
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
    case "pageHidden":
      return sendWaiting(unchanged, true);
    case "unmounted":
      return stopFailed(sendWaiting(unchanged, false));
  }
}
