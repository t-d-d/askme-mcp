# ADR 3: An ask is delivered at least once and deduplicated by content

Decided on 9 October 2026: the ask call may arrive more than once, and the service removes the copies. An ask identical to one posted on the same account in the last ten minutes returns the first one's id.

Parent PRD: [PRD](../../PRD.md). Follows from [ADR 2](0002-agents-write-only.md).

## Constraint-set delta

Adds [`docs/constraints/ask-idempotency.md`](../constraints/ask-idempotency.md).

## Context

- **Agents retry.** After a timeout, an MCP client or the agent's own loop sends the call again without knowing whether the first one landed.
- **Agents send no idempotency key.** The caller is a language model following a tool description. It cannot be relied on to mint a key and reuse the same one on a retry.
- **Agents cannot check.** Under [ADR 2](0002-agents-write-only.md) they have no read, so they cannot look for the first ask.
- **A duplicate is visible.** It shows as a second card, in a product whose aim is a short list. Agents are told to err towards posting, which makes duplicates more likely.

## Decision

The service treats an identical ask, arriving soon after the first, as the same ask.

1. On each **ask** call the service computes a fingerprint of the content. It covers every field the agent sent: summary, area, spoken detail, both links and the id to replace. Surrounding whitespace is trimmed first.
2. If the same account posted an ask with the same fingerprint in the last ten minutes, the call returns that ask's id and stores nothing new.
3. Otherwise the service stores a new ask and returns a new id.
4. The check and the write are one atomic step, so two copies arriving together cannot both be stored.
5. The match ignores whether the first ask is still open. A retry of an ask the user already dismissed does not bring the card back.
6. The caller cannot tell a deduplicated call from a fresh one. Both return an id and the same status.
7. The tool description tells agents what to do after a timeout: send the same ask again, unchanged.

This is best effort. A retry that the agent rewords is a different ask as far as the service can tell, and makes a second card.

## Alternatives considered

1. **Require an idempotency key from the agent.** This is the standard answer for an API. Rejected: the caller is a language model. It may leave the key out, or mint a fresh one on the retry, which defeats it. It also adds a field to every call. An implementer is likely to reach for this, so it becomes a "Do not" in the constraint file.
2. **Use the protocol's own request id.** Rejected: a retry made by the agent's loop is a new request with a new id, so this would only catch resends at the transport level.
3. **Match loosely, so a reworded retry also matches.** Rejected: two different asks from the same piece of work can look alike, and merging them hides a real ask. That is worse than a duplicate. It would also cost a model call on every post.
4. **Match against every open ask, with no time limit.** Rejected: an agent that asks the same thing again a day later means it, and the user should see that it is still waiting.
5. **Do nothing, and let the user swipe duplicates away.** Rejected: duplicates are the clutter this product exists to remove.

## Fitness functions

All six run in CI and block a merge.

| Check | What it asserts | What it catches |
| --- | --- | --- |
| Same call twice | Posting an identical ask twice returns one id and stores one ask. | Deduplication being removed or broken. |
| Two at once | Two identical asks sent at the same moment store one ask. | A check followed by a separate write. |
| Any difference is new | Changing any one field makes a new ask. | Matching on too little, which would hide a real ask. |
| The window ends | An identical ask sent after the window makes a new ask. | A match that never expires. |
| Accounts are separate | The same content on two accounts makes two asks. | A fingerprint that is not tied to the account. |
| Replies look the same | A deduplicated call's reply has the same shape as a fresh one. | The reply revealing that a match was found. |

## Consequences

**Easier**

- A timeout is safe to retry, so the instruction to agents is one line.
- The tool has no extra field for an agent to get wrong.
- It works the same for every vendor's agent.

**Harder, and accepted**

- A retry that the agent rewords makes a second card. This is best effort, not a guarantee.
- Two asks that are deliberately identical, sent within ten minutes, collapse into one. An agent that wants two cards has to word them differently.
- Ten minutes is a judgement, not a measurement. The service should count how often a match is found, so the figure can be tuned.
- The service keeps a short-lived record of each fingerprint for the length of the window.
