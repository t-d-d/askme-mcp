# Error contract
Relevance: Any refusal from an MCP tool or the API, a call to an unknown tool, a call that fails before a tool runs, a new limit, or the wording of an error message or tool description: errors module, tool handlers, API handlers, the MCP handler, schemas
Decision: Every refusal from a tool carries one of six codes, each marked retry or do not retry, and is sent as a tool result the model can read.

Why: The caller is a language model. It acts on the words of a
refusal, so a vague one causes a loop or a lost ask.

## Rules

- Do not retry: invalid_input, cap_reached, not_found,
  insufficient_scope. Retry: rate_limited, service_unavailable.
- A refusal is a tool result marked as an error: code, class, message.
- A call that fails before a tool runs gets no tool result.
- A call without a valid token gets a 401 that points to the metadata.
- A failure in the handler before the token is checked gets a 503
  whose body is the service_unavailable refusal: code, class, message.
- A request over the API's total rate gets API Gateway's own 429 and
  never reaches the handler. askme adds nothing to it
  (api-throttle.md).
- A failure while the SDK holds the call, after the token is checked
  and before a tool runs, keeps the SDK's 500 and JSON-RPC error
  -32603. This includes askme's code that the SDK calls to build the
  server. askme adds nothing to the answer.
- Any other unexpected failure maps to service_unavailable.
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
- Answer a call with a tool result before its token is checked:
  askme answers no tool call from a caller it has not verified.
- Answer with a 401 when the key set could not be fetched: the client
  sends the person to sign in again, which cannot help while Clerk is
  down.
- Rewrite the SDK's answer to its own failure as a 503 or a tool
  result: it is the protocol's internal error, and a retry is unlikely
  to fix a fault in the code.
- Shape API Gateway's 429 into a refusal: an HTTP API cannot change
  an answer it sends itself, and a REST API costs three and a half
  times as much per request.

Judgment: A failure that fits no code is service_unavailable until
the ADR changes. An unknown tool name is not such a failure, nor is a
failure while the SDK holds the call, nor a request API Gateway
throttles.

History: [ADR 11](../adr/0011-error-contract.md), [ADR 19](../adr/0019-unknown-tool-name.md), [ADR 24](../adr/0024-failure-before-a-tool-runs.md), [ADR 30](../adr/0030-api-throttle.md)
