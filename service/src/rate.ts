export interface RateLimit {
  limit: number;
  windowMinutes: number;
}

// Also names the store's counter for the limit.
export type LimitName = "poll" | "ask" | "rulesSave" | "modelCall";

export const rateLimits: Readonly<Record<LimitName, Readonly<RateLimit>>> = {
  // The page polls every five seconds while it is visible, so a page open
  // on two devices sends about 24 polls a minute.
  poll: { limit: 60, windowMinutes: 1 },

  // Slows an agent that floods before it uses up the day's cap.
  ask: { limit: 30, windowMinutes: 1 },

  // Each save makes a model call for the rules and one for each open ask,
  // so a page pressed over and over is slowed before it spends much.
  rulesSave: { limit: 10, windowMinutes: 1 },

  // One UTC day. A day of normal use is a few hundred calls, so only a
  // scripted account reaches the cap (ADR 21).
  modelCall: { limit: 2000, windowMinutes: 24 * 60 },
};

export interface RateWindow {
  // The minute the window starts, such as "2026-10-11T09:30".
  name: string;
  // Milliseconds since the epoch.
  endsAt: number;
}

const minuteMs = 60_000;

export function windowOf(now: Date, minutes: number): RateWindow {
  const length = minutes * minuteMs;
  const start = Math.floor(now.getTime() / length) * length;
  return {
    name: new Date(start).toISOString().slice(0, 16),
    endsAt: start + length,
  };
}

export function secondsLeft(window: RateWindow, now: Date): number {
  return Math.max(1, Math.ceil((window.endsAt - now.getTime()) / 1000));
}
