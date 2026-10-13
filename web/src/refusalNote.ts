// The note under "Save rules" or "Send sample asks" when a press does not go
// through: which limit it reached and when to try again, in the page's own
// words (docs/design.md, "Words"). Each button ends a failure's note in its
// own way, so its words stop before "Try again".
//
// The daily cap's note goes once the cap resets, at the next midnight UTC
// by the service's clock, which counts the cap. The note gives that time in
// this browser's time zone, or in the one given.
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
