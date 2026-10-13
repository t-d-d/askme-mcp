# ADR 27: An identical ask after the first has expired is posted as new

Decided on 13 October 2026: an identical ask within ten minutes returns the first ask's id only while the first ask is open and not expired, or after the person dismissed it. Once the first ask has expired, an identical ask is posted as new, as it is after the agent closed the first. This amends point 4 of [ADR 23](0023-agent-closed-asks-are-not-matched.md). Issue #345 asked for it.

Parent PRD: [PRD](../../PRD.md). Amends point 4 of [ADR 23](0023-agent-closed-asks-are-not-matched.md).

## Constraint-set delta

Edits [`docs/constraints/ask-idempotency.md`](../constraints/ask-idempotency.md): the rule "A match counts while the first ask is open or dismissed" becomes a rule that a match counts while the first ask is open or dismissed and has not expired, and that an expired first ask is posted over as new. A "Do not" entry is narrowed to an unexpired dismissal, and one is added against reading the first ask without its expiry check.

## Context

- **A replacing ask keeps the expiry of the ask it replaces** ([ADR 13](0013-table-design.md)). Near the end of a chain of replacements, the newest ask can expire minutes after it is posted.
- **ADR 23 matched any first ask still open.** Its point 4 returns the first id while the first ask is open, and an expired ask was never closed, so it still matched. The repeat got the expired ask's id. Nothing stored a new card, the agent believed it had posted, and the person saw nothing.
- **The match exists to stop a second card.** An expired ask shows no card, so a repeat of it cannot make a second one.

## Decision

The match counts while the first ask is open or dismissed, and has not expired.

1. On a match, the service reads the first ask's open item. If it is there and not expired, the call returns the first ask's id and stores nothing, as before.
2. Otherwise the service reads the first ask's closed item. If it is there, not expired, and closed as `dismissed`, the call returns the first ask's id and stores nothing.
3. In every other case (the agent closed the first ask, or it expired) the service posts the new ask and takes over the dedupe record as ADR 23 sets out: in the same transaction, on condition the record still names the first ask.
4. Expiry is checked on read, as for every other read ([ADR 13](0013-table-design.md)). So an ask the person dismissed, which then expired, no longer matches either.

The rest of ADR 23 stands.

## Alternatives considered

1. **Keep matching an expired ask.** Rejected: the agent is told its ask was stored while the person sees nothing, which is the failure this record fixes.
2. **Give a replacing ask a fresh expiry.** Rejected: it changes ADR 13's rule that a replacement keeps the old ask's age and expiry, which the page relies on to show how long a question has waited. It also leaves the same gap for any ask posted near its expiry.
3. **Match a dismissed ask even after it expired, by reading its closed item without the expiry check.** Rejected: it breaks the rule that expiry is checked on every read, and still fails once DynamoDB deletes the item, at a time nobody controls. The case needs a dismissal and an expiry inside the same ten minutes. An implementer is likely to reach for this, so it is a "Do not" in the constraint file.

## Fitness functions

It runs in CI and blocks a merge. ADR 23's three checks still hold.

| Check | What it asserts | What it catches |
| --- | --- | --- |
| Expired is new | An ask identical to one that expired within the last ten minutes makes a new card with a new id, whether the first was never closed or the person dismissed it. | The match ignoring the first ask's expiry again, or a dismissed ask read without its expiry check. |

## Consequences

**Easier**

- An agent near the end of a chain of replacements still gets a card when it repeats an ask.

**Harder, and accepted**

- A match on an open ask costs the same one read as under ADR 23. A match on a dismissed ask costs two, since the open item is read first.
- A late retry of an ask the person dismissed brings the card back if the ask expired between the dismissal and the retry. It needs both inside ten minutes, at the end of an ask's thirty days.
