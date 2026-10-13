// Each button ends a failed press's note in its own way, so these words stop
// before "Try again".
import { capped, Refusal } from "./load";
import { resetsHere, resetTime } from "./resets";

export type RefusalNote =
  | { kind: "cap"; words: string; goesAt: number }
  | { kind: "rate" | "failed"; words: string; goesAt?: never };

export function refusalNote(
  error: Error,
  sentAt: number,
  timeZone?: string,
): RefusalNote {
  if (capped(error)) {
    return {
      kind: "cap",
      words: `You've reached today's limit. It resets at ${resetTime(sentAt + error.serviceAhead, timeZone)}.`,
      goesAt: resetsHere(sentAt, error.serviceAhead),
    };
  }
  if (error instanceof Refusal && error.code === "rate_limited") {
    return {
      kind: "rate",
      words: "Slow down a little. Try again in a few seconds.",
    };
  }
  return { kind: "failed", words: "That didn't go through." };
}
