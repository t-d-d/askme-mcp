import { inspect } from "node:util";
import { vi } from "vitest";

export interface Captured {
  method: string;
  args: unknown[];
}

// Every method, so a line written around the shared logger is caught too.
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

// Objects in full, so nothing hides inside one.
export function lineText(line: Captured): string {
  return line.args
    .map((arg) =>
      typeof arg === "string"
        ? arg
        : inspect(arg, { depth: null, breakLength: Infinity }),
    )
    .join(" ");
}
