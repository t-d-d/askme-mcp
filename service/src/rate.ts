// Rate limits, counted in fixed windows of whole minutes (ADR 18). A window
// is named by the minute it starts, which the counter's key carries.

// The page's poll (ADR 1). The page polls every five seconds while it is
// visible, so a page open on two devices sends about 24 polls a minute.
export const pollLimit: Readonly<{ polls: number; windowMinutes: number }> = {
  polls: 60,
  windowMinutes: 1,
};

// The ask tool. It slows an agent that floods before it uses up the day's
// cap. Every call that reaches the store is counted, a repeat included.
export const askLimit: Readonly<{ asks: number; windowMinutes: number }> = {
  asks: 30,
  windowMinutes: 1,
};

export interface RateWindow {
  // The minute the window starts, such as "2026-10-11T09:30".
  name: string;
  // When the next window starts, in milliseconds since the epoch.
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

// How long until the next window, in whole seconds, rounded up.
export function secondsLeft(window: RateWindow, now: Date): number {
  return Math.max(1, Math.ceil((window.endsAt - now.getTime()) / 1000));
}
