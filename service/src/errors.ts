// The error contract (ADR 11). Every refusal carries one of these codes, and
// each code is marked retry or do not retry. A refusal is a tool result
// marked as an error, so the model that called the tool reads it.
import type { CallToolResult } from "@modelcontextprotocol/server";

export const codes = {
  invalid_input: "do not retry",
  cap_reached: "do not retry",
  not_found: "do not retry",
  insufficient_scope: "do not retry",
  rate_limited: "retry",
  service_unavailable: "retry",
} as const;

export type Code = keyof typeof codes;

// How many times an agent may send the same call again after a retry code,
// before it carries on without askme. The tool descriptions state it.
export const retryBudget = 2;

export function refusal(code: Code, message: string): CallToolResult {
  const body = { code, class: codes[code], message };
  return {
    content: [{ type: "text", text: JSON.stringify(body) }],
    isError: true,
  };
}
