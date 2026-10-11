// Captures what service code writes to the console, which is where Lambda
// reads its log lines. Every console method is captured, so a line written
// around the shared logger is caught as well.
import { inspect } from "node:util";
import { vi } from "vitest";

export interface Captured {
  method: string;
  args: unknown[];
}

const methods = ["log", "info", "warn", "error", "debug", "trace"] as const;

export function captureLogs(): { lines: Captured[]; restore(): void } {
  const lines: Captured[] = [];
  const spies = methods.map((method) =>
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push({ method, args });
    }),
  );
  return {
    lines,
    restore: () => {
      for (const spy of spies) spy.mockRestore();
    },
  };
}

// A captured line as text, for searching. Objects are shown in full, an
// error with its message and stack, so nothing hides inside one.
export function lineText(line: Captured): string {
  return line.args
    .map((arg) =>
      typeof arg === "string"
        ? arg
        : inspect(arg, { depth: null, breakLength: Infinity }),
    )
    .join(" ");
}
