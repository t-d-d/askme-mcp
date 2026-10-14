import { useEffect, type MouseEvent } from "react";
import { pageReloads } from "./reload";
import type { AskFirst } from "./screen";
import { elsewhere } from "./toList";

// The screens ask when Back or a typed address changes the fragment, and the
// browser asks as the tab closes. The screen's own links ask through away,
// before the address changes, so staying adds nothing to the history. A
// reload for an answer the page cannot read waits while the guard holds.
export function useLeaveGuard(
  changed: boolean,
  askFirst: AskFirst,
  leaving: string,
): { away: (event: MouseEvent) => void; mayLeave: () => boolean } {
  useEffect(() => {
    if (!changed) return;
    askFirst(leaving);
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    const release = pageReloads.hold();
    return () => {
      askFirst(null);
      window.removeEventListener("beforeunload", warn);
      release();
    };
  }, [changed, askFirst, leaving]);
  const away = (event: MouseEvent) => {
    if (!changed || elsewhere(event)) return;
    if (window.confirm(leaving)) askFirst(null);
    else event.preventDefault();
  };
  const mayLeave = () => {
    if (!changed) return true;
    if (!window.confirm(leaving)) return false;
    askFirst(null);
    return true;
  };
  return { away, mayLeave };
}
