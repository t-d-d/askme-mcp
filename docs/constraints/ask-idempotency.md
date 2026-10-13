# Ask idempotency
Relevance: The ask tool's write path, retries or duplicate handling: the ask handler, the store's write for a new ask, the tool description
Decision: ask is delivered at least once; an identical ask on one account in ten minutes returns the first id, unless the first expired or the agent closed it.

Why: Agents retry after a timeout, send no idempotency key and cannot
read to check. A duplicate is a second card in a list meant to be short.

## Rules

- The fingerprint covers every field the agent sent, with whitespace
  trimmed, and is tied to the account.
- The check and the write are one atomic step.
- A match returns the first ask's id and stores nothing.
- A match counts while the first ask is open and not expired, or
  dismissed. If the agent closed it, as resolved or replaced, or it
  expired, the ask is posted as new.
- A new ask posted over such a match takes over the dedupe record in
  the same transaction, on condition the record still names the
  first ask.
- A deduplicated reply has the same shape as a fresh one.
- The tool description says: after a timeout, resend unchanged.

## Do not

- Add a required idempotency key: the caller is a language model, and
  will leave it out or mint a new one on the retry.
- Match loosely: merging two different asks hides a real one.
- Check and then write in two steps: two retries arriving together
  would both be stored. This holds for taking over the record too.
- Post a repeat of a dismissed ask as new: a late retry would bring
  back a card the person swiped away.

History: [ADR 3](../adr/0003-idempotency.md), [ADR 23](../adr/0023-agent-closed-asks-are-not-matched.md), [ADR 27](../adr/0027-expired-asks-are-not-matched.md)
