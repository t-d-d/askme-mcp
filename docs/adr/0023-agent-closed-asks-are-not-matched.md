# ADR 23: An identical ask after the agent closed the first is posted as new

Decided on 13 October 2026: an identical ask within ten minutes still returns the first ask's id while the first ask is open, or after the person dismissed it. Once the agent has closed the first ask, by resolving or replacing it, an identical ask is posted as new. This replaces point 5 of [ADR 3](0003-idempotency.md). Issue #335 raised it, and the owner agreed to it.

Parent PRD: [PRD](../../PRD.md). Replaces point 5 of [ADR 3](0003-idempotency.md).

## Constraint-set delta

Edits [`docs/constraints/ask-idempotency.md`](../constraints/ask-idempotency.md): the rule "The match ignores the first ask's state" becomes a rule that a match counts only while the first ask is open or dismissed, and a rule on taking over the dedupe record is added.

## Context

- **Agents ask the same thing twice for real.** An agent resolves "Approve the passkey prompt in Chrome", then needs the same approval again a few minutes later. Under ADR 3 the second call returns the closed ask's id. No card appears, and the agent believes it posted.
- **That second call cannot be a retry.** An agent can resolve or replace an ask only with its id, so it held the answer to the first call. ADR 3 deduplicates to catch a retry whose answer was lost. Here no answer was lost.
- **A dismissal is different.** The person swiped the card away. A late retry of that call must not bring it back, which is what ADR 3 point 5 was for.

## Decision

The match counts while the first ask is open or dismissed, and not once the agent has closed it.

1. On a match, the service reads the ask the dedupe record names.
2. If that ask is closed as `resolved` or `replaced`, the service posts the new ask and returns its new id. In the same transaction it replaces the dedupe record with one naming the new ask, with a fresh ten-minute window.
3. The replacement is conditional on the record still naming the first ask. Two identical asks arriving together after a resolve both try it, one wins, and the other matches the new ask. One new ask is stored.
4. If the first ask is open, or closed as `dismissed`, the call returns the first ask's id and stores nothing, as before.
5. The ten-minute window is unchanged. The `askme/ask-deduplicated` query can show later whether it should shrink.

The rest of ADR 3 stands.

## Alternatives considered

1. **Shorten the window.** Rejected: a real repeat can come within any window long enough to catch retries, so this makes the problem rarer without removing it.
2. **Stop matching any closed ask, dismissals included.** Rejected: a late retry of an ask the person dismissed would bring the card back. That is the case ADR 3 point 5 was written for.
3. **Delete the dedupe record when the agent closes an ask.** Rejected: closing would then write an item it does not otherwise touch, and a resolve would need the ask's fingerprint, which the closed ask does not hold. Reading the first ask's state at the match keeps the change in one place.
4. **Read the record, then post in a separate unconditional write.** Rejected: two copies arriving together would both be stored. An implementer is likely to reach for this, so it is a "Do not" in the constraint file.

## Fitness functions

All three run in CI and block a merge. They replace ADR 3's test that a closed ask's repeat returns the first id.

| Check | What it asserts | What it catches |
| --- | --- | --- |
| Closed by the agent is new | An identical ask after the agent resolved, or replaced, the first makes a new ask with a new id. | The match ignoring the first ask's state again. |
| A dismissal still matches | An identical ask after the person dismissed the first returns the first id and stores nothing. | A dismissed card coming back on a late retry. |
| Two at once after a close | Two identical asks sent together after a resolve store one new ask. | Taking over the dedupe record without the condition. |

## Consequences

**Easier**

- An agent can ask the same thing again as soon as it has closed the first, and the person sees it.

**Harder, and accepted**

- Every match costs one more read than before, to learn the first ask's state, even when that ask is still open.
- An agent that resolves an ask by mistake and then retries the original call gets a second card. It held the first answer, so this is not a retry askme was built to catch.
