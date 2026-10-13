// Dismissing an ask (docs/design.md, "The open card"). What happens next
// is decided in dismissing.ts. This hook keeps its state, runs its timers
// and sends its dismissals, and tells it when a timer runs out, a send
// fails, the list shows or goes, the page closes or the person signs out.
import { useCallback, useEffect, useRef, useState } from "react";
import { askChangePaths } from "../../shared/page-api";
import { useAuth } from "./auth";
import {
  initial,
  step,
  type DismissEffect,
  type DismissEvent,
  type DismissNote,
  type Timer,
} from "./dismissing";
import { changeAsk } from "./load";

// How long the note with Undo shows before the dismissal is sent, and how
// long a note that it failed stays.
export const undoMs = 5000;

export interface Dismissing {
  // The asks dismissed on this page, which the list leaves out.
  dismissed: ReadonlySet<string>;
  note: DismissNote | null;
  dismiss: (id: string) => void;
  undo: () => void;
}

export function useDismissing(listShown: boolean): Dismissing {
  const { getToken } = useAuth();
  // The latest way to get a token, so that the functions below keep their
  // identity, and nothing but leaving the list or the page sends early.
  const token = useRef(getToken);
  useEffect(() => {
    token.current = getToken;
  }, [getToken]);
  const state = useRef(initial(listShown));
  const [dismissed, setDismissed] = useState(state.current.dismissed);
  const [note, setNote] = useState(state.current.note);
  const timers = useRef<Record<Timer, number | undefined>>({
    undo: undefined,
    failed: undefined,
  });

  const dispatch = useCallback(function dispatch(event: DismissEvent) {
    const next = step(state.current, event);
    state.current = next.state;
    setDismissed(next.state.dismissed);
    setNote(next.state.note);
    next.effects.forEach((effect: DismissEffect) => {
      switch (effect.type) {
        case "send":
          void changeAsk(
            askChangePaths.dismissed,
            { id: effect.id },
            token.current,
            { keepalive: effect.keepalive },
          ).catch((error: unknown) => {
            dispatch({ type: "failed", id: effect.id, error });
          });
          return;
        case "start":
          timers.current[effect.timer] = window.setTimeout(() => {
            dispatch({ type: "timeUp", timer: effect.timer });
          }, undoMs);
          return;
        case "clear":
          window.clearTimeout(timers.current[effect.timer]);
          timers.current[effect.timer] = undefined;
          return;
      }
    });
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      dispatch({ type: "dismiss", id });
    },
    [dispatch],
  );
  const undo = useCallback(() => {
    dispatch({ type: "undo" });
  }, [dispatch]);

  useEffect(() => {
    dispatch({ type: "list", shown: listShown });
  }, [listShown, dispatch]);

  useEffect(() => {
    const leaving = () => {
      dispatch({ type: "pageHidden" });
    };
    window.addEventListener("pagehide", leaving);
    return () => {
      window.removeEventListener("pagehide", leaving);
      dispatch({ type: "unmounted" });
    };
  }, [dispatch]);

  return { dismissed, note, dismiss, undo };
}
