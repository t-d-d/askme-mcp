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
