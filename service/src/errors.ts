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

// Resends an agent may make after a retry code before it carries on
// without askme.
export const retryBudget = 2;

export class Refused {
  readonly code: Code;
  readonly message: string;
  constructor(code: Code, message: string) {
    this.code = code;
    this.message = message;
  }
}

// A tool result marked as an error, so the model that called the tool reads
// it.
export function refusal(code: Code, message: string): CallToolResult {
  const body = { code, class: codes[code], message };
  return {
    content: [{ type: "text", text: JSON.stringify(body) }],
    isError: true,
  };
}

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

// Any unexpected failure, on the page's routes and the MCP endpoint alike
// (ADR 11).
export function unavailable(): Response {
  return pageRefusal(
    "service_unavailable",
    "askme could not finish this request. Try again in a moment.",
  );
}
