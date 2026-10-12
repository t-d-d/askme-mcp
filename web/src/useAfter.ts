// Calls a function once a moment has passed, by this browser's clock, with
// no reload. A computer or phone that sleeps can hold the browser's timers
// back, so it looks at the clock at least once a minute as well, and is at
// most a minute late after waking.
import { useEffect } from "react";

const lookMs = 60 * 1000;

export function useAfter(at: number | undefined, then: () => void): void {
  useEffect(() => {
    if (at === undefined) return;
    let timer = 0;
    const wait = () => {
      const left = Math.max(at - Date.now(), 0);
      timer = window.setTimeout(
        () => {
          if (Date.now() >= at) then();
          else wait();
        },
        Math.min(left, lookMs),
      );
    };
    wait();
    return () => {
      window.clearTimeout(timer);
    };
  }, [at, then]);
}
