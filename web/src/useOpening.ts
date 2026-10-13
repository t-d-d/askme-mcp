import { useCallback, useRef, useState } from "react";
import { askChangePaths } from "../../shared/page-api";
import { useAuth } from "./auth";
import { changeAsk } from "./load";

export interface Opening {
  // Opened on this page, before a poll says so.
  opened: ReadonlySet<string>;
  markOpened: (id: string) => void;
}

export function useOpening(): Opening {
  const { getToken } = useAuth();
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const sent = useRef(new Set<string>());
  const markOpened = useCallback(
    (id: string) => {
      if (sent.current.has(id)) return;
      sent.current.add(id);
      setOpened((before) => new Set(before).add(id));
      // A failed send loses nothing: the ask stays dimmed here, and the next
      // page to load the list shows it unopened.
      changeAsk(askChangePaths.opened, { id }, getToken).catch(() => undefined);
    },
    [getToken],
  );
  return { opened, markOpened };
}
