// The words a refusal uses for a rate limit and for how long to wait, from
// the limit's own constants (ADR 11). Each refusal keeps its own sentence,
// since an agent and the page are told different things, and builds it
// from these.
import type { RateLimit } from "./rate";

const plural = (count: number, word: string) =>
  `${String(count)} ${word}${count === 1 ? "" : "s"}`;

const minutesOf = (minutes: number) =>
  minutes === 1 ? "a minute" : plural(minutes, "minute");

// "Wait 12 seconds", or "Wait 1 second".
export const waitFor = (seconds: number): string =>
  `Wait ${plural(seconds, "second")}`;

// "60 times in a minute", or "10 times in 5 minutes".
export const timesIn = ({ limit, windowMinutes }: RateLimit): string =>
  `${String(limit)} times in ${minutesOf(windowMinutes)}`;

// "30 asks a minute", or "30 asks in 5 minutes".
export const countPer = (
  { limit, windowMinutes }: RateLimit,
  things: string,
): string =>
  `${String(limit)} ${things} ${windowMinutes === 1 ? "a minute" : `in ${minutesOf(windowMinutes)}`}`;
