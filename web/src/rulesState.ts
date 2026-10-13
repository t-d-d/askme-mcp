// What the rules screen shows, worked out from the rules loaded, the list
// polled, what the person typed and the last save (Rules.tsx says how each
// reads): the text in the box, whether it changed, whether "Save rules" is
// awake, and the one note under the button. The service gives its times by
// its own clock, serviceAhead ahead of this browser's (load.ts).
import type { AsksAnswer, RulesAnswer } from "../../shared/page-api";
import type { RefusalNote } from "./refusalNote";
import { capSpentUntil, sortingState } from "./sorting";

export interface RulesStateInput {
  // The rules as loaded or last saved, and whether the load failed.
  loaded: { data: RulesAnswer | undefined; failed: boolean };
  // The list as last polled: when that poll was made and when its answer
  // arrived, on this browser's clock.
  listed: {
    data: AsksAnswer | undefined;
    polledAt: number;
    serviceAhead: number;
    receivedAt: number;
  };
  // What the person has typed since the rules last loaded or saved.
  draft: string | null;
  // Whether the last save sent the text unchanged, after a reading that
  // succeeded, so askme sorts the asks again and reads nothing.
  resorting: boolean;
  // The last save: whether it is under way or succeeded, when it was sent,
  // and its refusal or failure, if it had one.
  save: {
    pending: boolean;
    succeeded: boolean;
    submittedAt: number;
    refused: RefusalNote | null;
  };
}

// The one note under the button.
export type NoteKind =
  | { kind: "none" }
  | { kind: "notConnected" }
  | { kind: "reading" }
  | { kind: "sorting" }
  | { kind: "refused"; words: string; retry: boolean }
  | { kind: "readFailed" }
  | { kind: "saved" }
  | { kind: "savedAsleep" };

export interface RulesState {
  text: string;
  changed: boolean;
  ready: boolean;
  note: NoteKind;
}

export function rulesState({
  loaded: { data, failed },
  listed,
  draft,
  resorting,
  save,
}: RulesStateInput): RulesState {
  const text = draft ?? data?.text ?? "";
  const changed = data !== undefined && draft !== null && draft !== data.text;
  const capSpent =
    capSpentUntil(
      listed.data?.modelCapResetsAt,
      listed.polledAt,
      listed.serviceAhead,
    ) !== null;
  const stopped =
    data !== undefined &&
    sortingState(listed.data?.asks ?? [], listed.polledAt, listed.serviceAhead)
      .stopped > 0;
  // A save of unchanged text would be refused while the limit is reached.
  const awake = stopped && !capSpent;
  const ready = changed || awake;
  // The note for a save of unchanged text stands until a poll that came
  // back after the save finds asks stopped again, or the limit reached.
  const resorted =
    resorting &&
    !(
      (stopped || capSpent) &&
      !save.pending &&
      listed.receivedAt > save.submittedAt
    );
  const saved = data !== undefined && (data.text !== "" || save.succeeded);
  return {
    text,
    changed,
    ready,
    note: noteOf({
      failed,
      pending: save.pending,
      refused: save.refused,
      changed,
      awake,
      resorted,
      readFailed: data?.readFailed ?? false,
      saved,
    }),
  };
}

// The first note that holds, in this order.
function noteOf(state: {
  failed: boolean;
  pending: boolean;
  refused: RefusalNote | null;
  changed: boolean;
  awake: boolean;
  resorted: boolean;
  readFailed: boolean;
  saved: boolean;
}): NoteKind {
  if (state.failed) return { kind: "notConnected" };
  if (state.pending) return { kind: state.resorted ? "sorting" : "reading" };
  if (state.refused !== null) {
    return {
      kind: "refused",
      words: state.refused.words,
      retry: state.refused.kind === "failed",
    };
  }
  if (state.changed) return { kind: "none" };
  if (state.readFailed) return { kind: "readFailed" };
  if (state.resorted) return { kind: "sorting" };
  // While some asks couldn't be sorted, and the limit is not reached, the
  // button is already awake.
  if (!state.saved) return { kind: "none" };
  return { kind: state.awake ? "saved" : "savedAsleep" };
}
