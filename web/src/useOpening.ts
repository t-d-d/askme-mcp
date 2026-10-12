// Following one of an ask's links marks it as opened (PRD, "Web page"). The
// page shows it opened at once, and tells the API, whose next poll agrees.
// Opening never clears an ask.
import { useCallback, useState } from "react";
import { askChangePaths } from "../../shared/page-api";
import { useAuth } from "./auth";
import { changeAsk } from "./load";

export interface Opening {
  // The asks opened on this page, before the list says so.
  opened: ReadonlySet<string>;
  markOpened: (id: string) => void;
}

export function useOpening(): Opening {
  const { getToken } = useAuth();
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const markOpened = useCallback(
    (id: string) => {
      setOpened((before) => new Set(before).add(id));
      // If the API does not take it, the ask stays dimmed on this page, and
      // the next page to load the list shows it unopened. Nothing is lost.
      changeAsk(askChangePaths.opened, { id }, getToken).catch(() => undefined);
    },
    [getToken],
  );
  return { opened, markOpened };
}
