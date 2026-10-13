import type { AsksAnswer, RulesAnswer } from "../../shared/page-api";
import type { RefusalNote } from "./refusalNote";
import { capSpentUntil, sortingState } from "./sorting";

export interface RulesStateInput {
  loaded: { data: RulesAnswer | undefined; failed: boolean };
  // polledAt and receivedAt are on this browser's clock.
  listed: {
    data: AsksAnswer | undefined;
    polledAt: number;
    serviceAhead: number;
    receivedAt: number;
  };
  draft: string | null;
  // The last save sent unchanged text after a good read, so askme sorts the
  // asks again and reads nothing.
  resorting: boolean;
  save: {
    pending: boolean;
    succeeded: boolean;
    submittedAt: number;
    refused: RefusalNote | null;
  };
}

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
  // The note for a save of unchanged text stands until a poll answered after
  // the save finds asks stopped again, or the limit reached.
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
  if (!state.saved) return { kind: "none" };
  return { kind: state.awake ? "saved" : "savedAsleep" };
}
