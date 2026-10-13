# ADR 24: An MCP call that fails before a tool runs gets no tool result

Decided on 13 October 2026: an MCP call that fails before any tool runs is not answered with a tool result. Before askme has verified the token, the handler answers with a 503 whose body is the `service_unavailable` refusal. After that, the MCP SDK holds the call, and a failure while it does keeps the SDK's answer: a 500 with JSON-RPC error -32603. This narrows [ADR 11](0011-error-contract.md) in two places. Its rule that only a token is refused at the HTTP level, and its rule that every unexpected failure maps to `service_unavailable`, each gain an exception. The rest of ADR 11 stands, and [ADR 6](0006-identity.md) is unchanged.

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

- Edits [`docs/constraints/error-contract.md`](../constraints/error-contract.md). The rule on what is answered at the HTTP level is replaced by four rules: a call that fails before a tool runs gets no tool result, a call without a valid token gets a 401, a failure before the token is checked gets a 503, and a failure while the SDK holds the call keeps the SDK's answer. "Any unexpected failure" becomes "any other unexpected failure". Three "Do not" entries are added, against a tool result before the token is checked, a 401 when the key set could not be fetched, and rewriting the SDK's answer. The `Decision:` line says it is about refusals from a tool. The `Judgment:` line says a failure while the SDK holds the call is not `service_unavailable`. The `Relevance:` line is wider, and this record is on the `History:` line.

## Context

- **The service can fail before it knows who is calling.** To verify an agent's token, the service fetches Clerk's key set. If Clerk cannot be reached, `verifyBearerToken` throws, and the catch in `handler()` in `service/src/handler.ts` answers with a 503. A setting the service cannot load fails the same way, earlier. #318 gave that 503 the `service_unavailable` body and left its status alone.
- **The SDK can fail after the token is checked.** Once the token is verified, the handler passes the call to the MCP SDK. If the SDK fails before a tool runs, for example because the server cannot be built, it answers with a 500 and JSON-RPC error -32603, "Internal server error". The handler logs it at error and passes the answer on.
- **ADR 11 forbids both as written.** It says only a missing or expired token is refused at the HTTP level, every other refusal is a tool result the model can read, and any unexpected failure maps to `service_unavailable`. An MCP client reports either answer as an error of its own, so the model may never read a code or its class. #323 asked the owner to decide the first case, and #341 the second.
- **A tool result would answer a caller nobody has checked.** [ADR 6](0006-identity.md) says every MCP tool verifies a token on every call. Before the check, askme does not know whose call it is, or whether the caller may call a tool at all.

## Decision

A call that fails before a tool runs gets no tool result. Whoever holds the call when it fails answers it: the handler before the token is checked, the SDK after.

1. **Before the token is checked.** A request to the MCP endpoint that fails after it reaches the handler and before its token has been verified, for a reason other than the token itself, gets HTTP status 503. Today that means Clerk's key set being out of reach, or the service's own settings failing to load. The body is the JSON `code`, `class` and `message` that the page's API sends for the same failure (ADR 11, item 9): `service_unavailable`, `retry`, and a message saying to try again. There is no JSON-RPC message. Which faults are the token's own is for `service/src/identity.ts` to sort.
2. **While the SDK holds the call, after the token is checked.** A failure before a tool runs keeps the SDK's answer. That covers a fault in the SDK and a fault in askme's own code that the SDK calls to build the server, such as reading the caller from the verified token. The answer is HTTP status 500 and JSON-RPC error -32603, with the id of the call that failed. askme adds no code, class or message, and does not replace the answer. The handler still logs it at error ([ADR 7](0007-logging.md)).
3. **A call without a valid token** still gets a 401 that points to the metadata ([ADR 6](0006-identity.md)). ADR 11 said "a missing or expired token". The handler sends the 401 for any token that fails verification, and the rule now says so.
4. **What stays.** Every refusal from a tool is still a tool result marked as an error, with one of the six codes. Any other unexpected failure still maps to `service_unavailable`.

## Alternatives considered

1. **Answer a failure before the token check with a tool result carrying `service_unavailable`.** The model would read the code and its class, as ADR 11 intends. Rejected: askme would answer a tool call from a caller it has not verified, against [ADR 6](0006-identity.md). It would also mean reading the JSON-RPC body of an unchecked request and building a reply outside the SDK. An implementer reading ADR 11 alone is likely to suggest this, so it becomes a "Do not" in the constraint file.
2. **Answer a failure before the token check with a 401, as if the token were bad.** Many token checks answer every failure this way. Rejected: the client would send the person through sign-in again, which cannot help while Clerk's key set is out of reach, and askme would be calling a token bad without having checked it. This also becomes a "Do not".
3. **Replace the SDK's 500 with askme's 503 and `service_unavailable` body.** It is one line in the handler, and every unexpected failure would then carry the same code. Rejected: the SDK's answer is the protocol's own internal error, which any MCP client knows. A failure here comes from askme's code or the SDK's, not from a service being out of reach, so a second try is unlikely to work. The retry class would only spend the agent's retry budget. askme also stays out of how the SDK answers, as ADR 19 chose.
4. **Make the SDK's failure a tool result.** Rejected for the reasons [ADR 19](0019-unknown-tool-name.md) gave for an unknown tool name: it means catching the failure inside the SDK and building a tool result for a call no tool has seen, code that has to be kept in step with every SDK release. Alternatives 3 and 4 become one "Do not".

## Fitness functions

Both run in the gate and block a merge. They land with this record, because the handler and the SDK already behave this way.

| Check | What it asserts | What it catches |
| --- | --- | --- |
| A failure before the token is checked is answered over HTTP | With the identity service's key set out of reach, the official MCP client connects with a well-formed token, using both handshakes. Every request it sends gets a 503 whose JSON body is exactly `service_unavailable`, `retry` and a message, with nothing internal and no JSON-RPC envelope. | A change that answers an unchecked call with an MCP message, sends a 401 for a token it never checked, or drops the code from the 503. |
| A failure while the SDK holds the call keeps the SDK's answer | With the MCP server made to fail as it is built, the official MCP client connects with a valid token, using both handshakes, and gets a 500 with JSON-RPC error -32603. | A change that rewrites the SDK's answer into a 503 or a tool result without a new decision, or an SDK upgrade that changes it. |

## Consequences

**Easier**

- No code changes. The handler and the SDK already answer this way, and the tests keep it so.
- askme answers no tool call before it has checked who sent it, so ADR 6 has no exception.
- askme does not take over how the SDK answers, as [ADR 19](0019-unknown-tool-name.md) also chose.

**Harder, and accepted**

- The model may never read a code or its retry class. An MCP client reports a 503 or a 500 as an error of its own, and what it does next is up to the client. askme never blocks an agent, so the agent still asks in its own session ([ADR 11](0011-error-contract.md)).
- The handler logs both failures at error, so the owner hears of them ([ADR 7](0007-logging.md)). The agent learns only that askme failed.
- `service_unavailable` no longer covers every unexpected failure. A reader of ADR 11 alone would miss that, and miss both exceptions here. The constraint file names all three records.
