# ADR 19: A call to a tool askme does not have gets the MCP spec's protocol error

Decided on 12 October 2026: a `tools/call` that names a tool askme does not have, such as `asks` for `ask`, is not a refusal. The MCP SDK answers it with the JSON-RPC protocol error the MCP spec asks for, and askme adds nothing of its own. This narrows [ADR 11](0011-error-contract.md). Its rule that no refusal is sent as a protocol error now covers only calls to the tools askme has. The rest of ADR 11 stands.

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

- Edits [`docs/constraints/error-contract.md`](../constraints/error-contract.md): a new rule that an unknown tool name is not a refusal and gets the spec's protocol error, a new "Do not" entry against turning it into a tool result, a wider `Relevance:` line, a sentence on its `Judgment:` line saying an unknown tool name is never `service_unavailable`, and this record on its `History:` line.

## Context

- **The SDK answers before askme's code runs.** For a tool name it does not know, `@modelcontextprotocol/server` replies with JSON-RPC error -32602, "Tool asks not found". No tool handler sees the call.
- **The MCP spec asks for exactly that.** Its [tools page](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) lists unknown tools among protocol errors, not tool execution errors.
- **ADR 11 forbids it as written.** It says a refusal is a tool result, never a protocol error, because the model never sees a protocol error. The high-effort code review of the pull request for #3 found this gap, and #26 asked the owner to decide.
- **No code in ADR 11 fits.** `invalid_input` is about the fields of a call. `service_unavailable`, which the constraint's `Judgment:` line gives any failure that fits no code, is marked retry, so it would tell the agent to resend a call that can never work.
- **It takes an invented name.** Clients call tools by the names `tools/list` gives them, and askme has two: `ask` and `resolve` ([ADR 2](0002-agents-write-only.md)). Only a client or a model that makes up a name reaches this.

## Decision

An unknown tool name is not a refusal, and the SDK answers it as the MCP spec says.

1. **What counts.** A `tools/call` whose name is not one of the tools `tools/list` returns.
2. **The answer.** JSON-RPC error -32602, with the SDK's message, which names the tool. askme adds no code, class or message, and does not take over how the SDK routes calls.
3. **What stays.** Every refusal from a tool askme has is still a tool result marked as an error, with one of the six codes. "Do not report a refusal as a protocol error" still holds, because this is not a refusal.
4. **The `Judgment:` line** of the constraint file does not apply. An unknown tool name is never `service_unavailable`.

## Alternatives considered

1. **Answer it as a tool result with `invalid_input`, naming the tools that exist.** The model would read the message and could correct the name. Rejected: it goes against the MCP spec, and it means replacing the SDK's handler for `tools/call` or catching its error, code that has to be kept in step with every SDK release. It also stretches `invalid_input` from fields to tool names. An implementer reading ADR 11 is likely to suggest this, so it becomes a "Do not" in the constraint file.
2. **Answer it with `service_unavailable`,** as the constraint's `Judgment:` line would have it. Rejected: the code is marked retry, so the agent would send the same call twice more, and it can never work.
3. **Add a seventh code, such as `unknown_tool`.** Rejected: ADR 11 refuses a code added in passing, because each one is a thing a model can mishandle. It would also need the same workaround as the first alternative, and it would still go against the spec.

## Fitness functions

It runs in the gate and blocks a merge. It lands with this record, because the SDK already behaves this way.

| Check | What it asserts | What it catches |
| --- | --- | --- |
| An unknown tool name gets the protocol error | Through the official MCP client, with both handshakes, a call to `asks` is answered with JSON-RPC error -32602 naming the tool, and with no tool result. | A workaround that turns the answer into a tool result, or an SDK upgrade that changes it, without a new decision. |

## Consequences

**Easier**

- There is no code to write or to keep in step with the SDK.
- askme answers as the spec says, so a client gets what any MCP server that follows the spec would give it.
- ADR 11's six codes keep their meaning. `invalid_input` is still only about fields.

**Harder, and accepted**

- The model may never learn why the call failed. Whether a protocol error reaches it is up to the client, and askme cannot change that.
- An agent that invents a tool name gets no list of the right ones from askme. It still has `tools/list` and the server instructions, and askme never blocks it, because it still asks in its own session ([ADR 11](0011-error-contract.md)).
- ADR 11 now has an exception, so a reader of ADR 11 alone would miss that one failure is not a tool result. The constraint file names both records.
