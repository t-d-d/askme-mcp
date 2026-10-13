import { useCallback, useEffect, useRef, useState } from "react";
import { askChangePaths } from "../../shared/page-api";
import { useAuth } from "./auth";
import {
  initial,
  step,
  type DismissEvent,
  type DismissNote,
  type Timer,
} from "./dismissing";
import { changeAsk } from "./load";

// Also how long the note that a dismissal failed stays.
export const undoMs = 5000;

export interface Dismissing {
  dismissed: ReadonlySet<string>;
  note: DismissNote | null;
  dismiss: (id: string) => void;
  undo: () => void;
}

export function useDismissing(listShown: boolean): Dismissing {
  const { getToken } = useAuth();
  // A ref, so dispatch keeps its identity and a new getToken does not run
  // the cleanup below, which sends early.
  const token = useRef(getToken);
  useEffect(() => {
    token.current = getToken;
  }, [getToken]);
  const [first] = useState(() => initial(listShown));
  // Events step from this before React renders the new state.
  const state = useRef(first);
  const [dismissed, setDismissed] = useState(first.dismissed);
  const [note, setNote] = useState(first.note);
  const timers = useRef<Record<Timer, number | undefined>>({
    undo: undefined,
    failed: undefined,
  });

  const dispatch = useCallback(function dispatch(event: DismissEvent) {
    const next = step(state.current, event);
    state.current = next.state;
    setDismissed(next.state.dismissed);
    setNote(next.state.note);
    next.effects.forEach((effect) => {
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
          window.clearTimeout(timers.current[effect.timer]);
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
