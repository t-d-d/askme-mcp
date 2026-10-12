// Dismissing an ask (docs/design.md, "The open card"): the ask goes from
// the list at once, and a note with Undo shows for a few seconds. The
// dismissal is sent when the note goes. If it fails, the ask comes back with
// a note that says so.
//
// One dismissal waits at a time. Dismissing another sends the waiting one
// at once, and so does leaving the list or closing the page.
import { useCallback, useEffect, useRef, useState } from "react";
import { askChangePaths } from "../../shared/page-api";
import { useAuth } from "./auth";
import { changeAsk, Refusal } from "./load";

// How long the note with Undo shows before the dismissal is sent, and how
// long a note that it failed stays.
export const undoMs = 5000;

export type DismissNote = "dismissed" | "failed";

export interface Dismissing {
  // The asks dismissed on this page, which the list leaves out.
  dismissed: ReadonlySet<string>;
  note: DismissNote | null;
  dismiss: (id: string) => void;
  undo: () => void;
}

const without = (ids: ReadonlySet<string>, id: string) => {
  const kept = new Set(ids);
  kept.delete(id);
  return kept;
};

export function useDismissing(): Dismissing {
  const { getToken } = useAuth();
  // The latest way to get a token, so that the functions below keep their
  // identity, and leaving the list is the only thing that sends early.
  const token = useRef(getToken);
  useEffect(() => {
    token.current = getToken;
  }, [getToken]);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [note, setNote] = useState<DismissNote | null>(null);
  // The dismissal waiting for its note to go, and the note's timer.
  const waiting = useRef<{ id: string; timer: number } | null>(null);
  const failedTimer = useRef<number | undefined>(undefined);

  // Sends a dismissal. An ask the API no longer has is gone either way.
  // A dismissal sent as the page closes is kept alive past it.
  const send = useCallback(async (id: string, keepalive = false) => {
    try {
      await changeAsk(askChangePaths.dismissed, { id }, token.current, {
        keepalive,
      });
    } catch (error) {
      if (error instanceof Refusal && error.code === "not_found") return;
      setDismissed((ids) => without(ids, id));
      setNote("failed");
      window.clearTimeout(failedTimer.current);
      failedTimer.current = window.setTimeout(() => {
        setNote((shown) => (shown === "failed" ? null : shown));
      }, undoMs);
    }
  }, []);

  // Sends the waiting dismissal now, if there is one, and its note goes, so
  // a page kept by the browser comes back with no Undo for it.
  const sendWaiting = useCallback(
    (keepalive = false) => {
      const pending = waiting.current;
      if (pending === null) return;
      window.clearTimeout(pending.timer);
      waiting.current = null;
      setNote((shown) => (shown === "dismissed" ? null : shown));
      void send(pending.id, keepalive);
    },
    [send],
  );

  const dismiss = useCallback(
    (id: string) => {
      sendWaiting();
      setDismissed((ids) => new Set(ids).add(id));
      setNote("dismissed");
      const timer = window.setTimeout(() => {
        waiting.current = null;
        // A note that an earlier dismissal failed keeps its own time.
        setNote((shown) => (shown === "dismissed" ? null : shown));
        void send(id);
      }, undoMs);
      waiting.current = { id, timer };
    },
    [send, sendWaiting],
  );

  const undo = useCallback(() => {
    const pending = waiting.current;
    if (pending === null) return;
    window.clearTimeout(pending.timer);
    waiting.current = null;
    setDismissed((ids) => without(ids, pending.id));
    setNote(null);
  }, []);

  // Closing the page or leaving it for another site sends the waiting
  // dismissal, so it is not lost with the page.
  useEffect(() => {
    const leaving = () => {
      sendWaiting(true);
    };
    window.addEventListener("pagehide", leaving);
    return () => {
      window.removeEventListener("pagehide", leaving);
      sendWaiting();
      window.clearTimeout(failedTimer.current);
    };
  }, [sendWaiting]);

  return { dismissed, note, dismiss, undo };
}
