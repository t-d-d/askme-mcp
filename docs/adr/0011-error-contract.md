# ADR 11: A refusal tells the agent what went wrong and whether to retry

Decided on 9 October 2026: every refusal from the MCP tools comes from one short table of codes. Each code is marked "retry" or "do not retry", and each message is written for a language model to act on. Whatever askme answers, the agent still asks in its own session.

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

Adds [`docs/constraints/error-contract.md`](../constraints/error-contract.md).

## Context

- **The caller is a language model.** It reads a refusal as text and decides what to do next. Given a vague message it may retry forever, or give up on something a second try would have fixed.
- **Two earlier decisions depend on the right reaction.** [ADR 3](0003-idempotency.md) relies on agents resending an ask unchanged after a timeout. A capped account or an over-long summary must not be resent unchanged.
- **The wording is part of the interface.** Models follow tool descriptions and error messages literally, so codes and messages are a published contract, as much as the tool names are.
- **askme is an extra channel.** An agent that cannot reach it must still be able to ask the person in its own session.

## Decision

There are six codes in two classes, and one rule above them all.

| Code | Class | When | What the agent should do |
| --- | --- | --- | --- |
| `invalid_input` | Do not retry as sent | A field is missing, too long or malformed. Every problem is listed, with the limit. | Fix the fields and send again. |
| `cap_reached` | Do not retry | The account has used its asks for the day. The message says when the cap resets. | Stop posting until then. |
| `not_found` | Do not retry | **resolve** named an id that this account has no ask for. | Nothing. Carry on. |
| `insufficient_scope` | Do not retry | The token lacks the permission. | Tell the person the connection needs approving again. |
| `rate_limited` | Retry | Too many calls in a short time. The reply says how long to wait. | Wait, then send the same call. |
| `service_unavailable` | Retry | The service could not finish. Any unexpected failure maps to this. | Send the same call again, within the retry budget. |

1. **A refusal is a tool result marked as an error**, carrying the code, the class and a message. The model reads it. Only a missing or expired token is refused at the HTTP level, where the client handles it.
2. **askme never blocks an agent.** Whatever the answer, the agent still asks its question in its own session. The server instructions say so.
3. **The retry budget is two retries.** After that the agent stops calling and carries on without askme. The tool descriptions state this.
4. **A retry is always safe.** A repeated **ask** is deduplicated ([ADR 3](0003-idempotency.md)), and a repeated **resolve** changes nothing.
5. **Messages are written for a model.** Each says what was wrong, what the limit is and what to do next.
6. **A message carries nothing about the account** beyond what the caller just sent, in keeping with [ADR 2](0002-agents-write-only.md). It never carries a stack trace or an internal error.
7. **Resolving an ask that is already closed succeeds.** Only an id that does not exist for the account is `not_found`.
8. **An unknown id in `replaces` never blocks an ask.** The ask is posted as a new one.
9. **The page's API uses the same codes**, so there is one table for both.
10. **Limits are constants shared** by the schema, the tool description and the error message, so the three cannot disagree.

## Alternatives considered

1. **Free-text errors.** The simplest thing to write. Rejected: the agent has to guess whether to retry, and a wrong guess is either a loop or a lost ask.
2. **Report every refusal as a protocol error.** Rejected: a client may show a protocol error to the person or abandon the call, and the model never sees it. A tool result marked as an error is what reaches the model.
3. **Accept bad input and repair it,** for example by cutting a long summary to the limit. Rejected: it mangles the agent's words without telling it, and the agent never learns to write shorter. An implementer is likely to suggest this, so it becomes a "Do not" in the constraint file.
4. **Many fine-grained codes.** Each failure would have its own. Rejected: every extra code is one more thing for a model to mishandle. Six codes in two classes cover what an agent can act on.

## Fitness functions

All five run in CI and block a merge.

| Check | What it asserts | What it catches |
| --- | --- | --- |
| One table of codes | Every refusal is built from the one exported table, each code with its class. Lint forbids an error reply built anywhere else. | A new code, or a free-text refusal, added in passing. |
| Unknown failures are contained | A handler forced to throw returns `service_unavailable`, with no stack trace and no internal message. | Internal detail reaching an agent. |
| Limits agree | The limits quoted in each tool description and each error message are the schema's own constants. | A description that promises one limit while the schema enforces another. |
| Every code arrives as a tool result | Through the official MCP client, each code is provoked and arrives as a tool result marked as an error, with its code and class. | A refusal sent as a protocol error, which the model never reads. |
| A repeat is safe | The same ask sent twice returns one id. A resolve sent twice succeeds twice. An ask with an unknown `replaces` id is posted. | A retry that duplicates an ask, or a harmless repeat turned into an error. |

## Consequences

**Easier**

- An agent's reaction to any refusal can be predicted, and tested.
- [ADR 3](0003-idempotency.md)'s "resend unchanged" is safe, because the agent is also told when not to.
- A new failure needs no design. It is one of six codes.
- The page and the agents share one table.
- If askme is down, the user loses a card. No agent loses its work.

**Harder, and accepted**

- The codes are a published contract. Renaming or removing one is a breaking change for every connected agent.
- Messages are prompts. They need the same care as tool descriptions, and the same testing against real agents.
- `service_unavailable` covers every unknown failure, so an agent cannot tell an outage from a bug. The logs can ([ADR 7](0007-logging.md)).
- Keeping to the retry budget is up to the agent. The rate limit is the backstop.
- When an agent gives up on askme, the ask is simply missing from the page. Nothing tells the user.
