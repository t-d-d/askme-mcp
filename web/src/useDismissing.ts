// Dismissing an ask (docs/design.md, "The open card"): the ask goes from
// the list at once, and a note with Undo shows for a few seconds. The
// dismissal is sent when the note goes. If it fails, the ask comes back with
// a note that says so.
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

export function useDismissing(listShown: boolean): Dismissing {
  const { getToken } = useAuth();
  // The latest way to get a token, so that the functions below keep their
  // identity, and nothing but leaving the list or the page sends early.
  const token = useRef(getToken);
  useEffect(() => {
    token.current = getToken;
  }, [getToken]);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [note, setNote] = useState<DismissNote | null>(null);
  // The dismissal waiting for its note to go, what sends it then, and the
  // note's timer.
  const waiting = useRef<{
    id: string;
    due: () => void;
    timer: number;
  } | null>(null);
  // The timer of the note that a dismissal failed, while it runs.
  const failedTimer = useRef<number | undefined>(undefined);
  // Whether the list shows, and whether a note that a dismissal failed
  // waits for it to show again.
  const listShowing = useRef(listShown);
  const failedAway = useRef(false);

  // Stops the time of the note that a dismissal failed.
  const stopFailed = useCallback(() => {
    window.clearTimeout(failedTimer.current);
    failedTimer.current = undefined;
  }, []);

  // Gives the note that a dismissal failed its full time, from now if the
  // list shows, or else from when it shows again. When it goes, a dismissal
  // still waiting gets its note with Undo back for its full time.
  const timeFailed = useCallback(() => {
    stopFailed();
    if (!listShowing.current) {
      failedAway.current = true;
      return;
    }
    failedTimer.current = window.setTimeout(() => {
      failedTimer.current = undefined;
      const pending = waiting.current;
      if (pending === null) {
        setNote(null);
        return;
      }
      setNote("dismissed");
      window.clearTimeout(pending.timer);
      pending.timer = window.setTimeout(pending.due, undoMs);
    }, undoMs);
  }, [stopFailed]);

  // Sends a dismissal. An ask the API no longer has is gone either way.
  // A dismissal sent as the page closes is kept alive past it.
  const send = useCallback(
    async (id: string, keepalive = false) => {
      try {
        await changeAsk(askChangePaths.dismissed, { id }, token.current, {
          keepalive,
        });
      } catch (error) {
        if (error instanceof Refusal && error.code === "not_found") return;
        setDismissed((ids) => without(ids, id));
        setNote("failed");
        // A dismissal still waiting stops its time while this note shows, and
        // its note with Undo comes back when this one goes.
        const held = waiting.current;
        if (held !== null) window.clearTimeout(held.timer);
        timeFailed();
      }
    },
    [timeFailed],
  );

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
      // This note takes the place of one that an earlier dismissal failed.
      stopFailed();
      setDismissed((ids) => new Set(ids).add(id));
      setNote("dismissed");
      const due = () => {
        sendWaiting();
      };
      waiting.current = { id, due, timer: window.setTimeout(due, undoMs) };
    },
    [sendWaiting, stopFailed],
  );

  const undo = useCallback(() => {
    const pending = waiting.current;
    if (pending === null) return;
    window.clearTimeout(pending.timer);
    waiting.current = null;
    setDismissed((ids) => without(ids, pending.id));
    setNote(null);
  }, []);

  // Leaving the list for another screen sends the waiting dismissal at once,
  // and stops the time of a note that a dismissal failed. That note gets its
  // full time as the list shows again.
  useEffect(() => {
    listShowing.current = listShown;
    if (!listShown) {
      sendWaiting();
      if (failedTimer.current !== undefined) timeFailed();
      return;
    }
    if (failedAway.current) {
      failedAway.current = false;
      timeFailed();
    }
  }, [listShown, sendWaiting, timeFailed]);

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
      stopFailed();
    };
  }, [sendWaiting, stopFailed]);

  return { dismissed, note, dismiss, undo };
}
