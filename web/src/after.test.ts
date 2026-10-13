import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { after } from "./after";

const at = (iso: string) => Date.parse(iso);
const midnight = at("2026-10-13T00:00:00Z");

beforeEach(() => {
  vi.useFakeTimers({ now: at("2026-10-12T15:00:00Z") });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("calling a function once a moment has passed", () => {
  it("calls it at the moment, and not before", () => {
    const then = vi.fn();
    after(midnight, then);
    vi.advanceTimersByTime(midnight - Date.now() - 1);
    expect(then).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(then).toHaveBeenCalledOnce();
  });

  it("calls it within a minute when the clock passes the moment with no timer due", () => {
    const then = vi.fn();
    after(midnight, then);
    vi.setSystemTime(at("2026-10-13T07:00:00Z"));
    vi.advanceTimersByTime(60_000 - 1);
    expect(then).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(then).toHaveBeenCalledOnce();
  });

  it("calls it with the next timer, not at once, when the moment has passed", () => {
    const then = vi.fn();
    after(at("2026-10-12T14:00:00Z"), then);
    expect(then).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(then).toHaveBeenCalledOnce();
  });

  it("does not call it once stopped", () => {
    const then = vi.fn();
    const stop = after(midnight, then);
    vi.advanceTimersByTime(60_000);
    stop();
    vi.advanceTimersByTime(midnight - Date.now());
    expect(then).not.toHaveBeenCalled();
  });
});
