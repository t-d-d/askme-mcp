# Error contract
Relevance: Any refusal from an MCP tool or the API, a call to an unknown tool, a new limit, or the wording of an error message or tool description: errors module, tool handlers, API handlers, schemas
Decision: Every refusal carries one of six codes, each marked retry or do not retry, and is sent as a tool result the model can read.

Why: The caller is a language model. It acts on the words of a
refusal, so a vague one causes a loop or a lost ask.

## Rules

- Do not retry: invalid_input, cap_reached, not_found,
  insufficient_scope. Retry: rate_limited, service_unavailable.
- A refusal is a tool result marked as an error: code, class, message.
- Only a missing or expired token is refused at the HTTP level.
- Any unexpected failure maps to service_unavailable.
- A message says what was wrong, the limit, and what to do next.
- A message carries nothing about the account beyond what was sent.
- Limits are constants shared by schema, description and message.
- A repeated call is always safe. Resolving a closed ask succeeds.
- An unknown replaces id posts the ask as new.
- The retry budget is two, stated in the tool descriptions.
- The page's API uses the same table.
- An unknown tool name is not a refusal. The SDK answers it with the
  MCP spec's protocol error, -32602.

## Do not

- Repair bad input silently, such as cutting a long summary.
- Add a code in passing: each one is a thing a model can mishandle.
- Report a refusal as a protocol error: the model never sees it.
- Put a stack trace or an internal message in a reply.
- Make any refusal a reason for the agent to stop its own work.
- Turn an unknown tool name into a tool result: it goes against the
  MCP spec, and means taking over how the SDK routes calls.

Judgment: A failure that fits no code is service_unavailable until
the ADR changes. An unknown tool name is not such a failure.

History: [ADR 11](../adr/0011-error-contract.md), [ADR 19](../adr/0019-unknown-tool-name.md)
