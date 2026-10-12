// Calls a function once a moment has passed, with no reload (after.ts).
// Without a moment, it waits for nothing.
import { useEffect, useEffectEvent } from "react";
import { after } from "./after";

export function useAfter(at: number | undefined, then: () => void): void {
  const fire = useEffectEvent(then);
  useEffect(() => {
    if (at === undefined) return;
    return after(at, () => {
      fire();
    });
  }, [at]);
}
