// The error contract (ADR 11). Every refusal carries one of these codes, and
// each code is marked retry or do not retry. A refusal is a tool result
// marked as an error, so the model that called the tool reads it. The page's
// API uses the same codes, as the body of an HTTP response.
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

// A refusal a tool decides on as it runs, such as not_found. The tool
// wrapper sends it on as a refusal.
export class Refused {
  readonly code: Code;
  readonly message: string;
  constructor(code: Code, message: string) {
    this.code = code;
    this.message = message;
  }
}

export function refusal(code: Code, message: string): CallToolResult {
  const body = { code, class: codes[code], message };
  return {
    content: [{ type: "text", text: JSON.stringify(body) }],
    isError: true,
  };
}

// The HTTP status of a refusal from the page's API, for each code.
const statuses: Record<Code, number> = {
  invalid_input: 400,
  cap_reached: 429,
  not_found: 404,
  insufficient_scope: 403,
  rate_limited: 429,
  service_unavailable: 503,
};

export function pageRefusal(code: Code, message: string): Response {
  return Response.json(
    { code, class: codes[code], message },
    { status: statuses[code], headers: { "cache-control": "no-store" } },
  );
}
