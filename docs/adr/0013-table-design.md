# ADR 13: One table, with everything keyed by account

Decided on 9 October 2026: all data is in one DynamoDB table, and every item's partition key is the account it belongs to. There are no secondary indexes and no scans. An account can only ever reach its own items, because the key itself carries the account.

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

Adds [`docs/constraints/table-design.md`](../constraints/table-design.md).

## Context

- **DynamoDB reads only along its keys.** The keys are chosen once, and changing them later means moving the data.
- **Every read and write belongs to one account.** The page lists its own open asks, an agent resolves an ask by id within its account, and rules belong to an account. Nothing in the product reads across accounts.
- **[ADR 1](0001-polling.md) wants an idle poll to cost one read.**
- **[ADR 2](0002-agents-write-only.md) wants an id from another account to look exactly like an id that does not exist.**
- **[ADR 3](0003-idempotency.md) wants the dedupe check and the write to be one atomic step.**
- **Closed asks are kept for a month,** so reading the open ones must not get slower as closed ones build up.

## Decision

The partition key is the account, and the sort key says what the item is.

| Item | Sort key | What it holds | Expires |
| --- | --- | --- | --- |
| Account marker | `META` | A version number that goes up on every change to the account's asks or rules | Never |
| Rules | `RULES` | The rules text, the hashtags and time windows read from it, the time zone, and a rules version | Never |
| Open ask | `OPEN#<ask id>` | The ask, its sort result, and the rules version it was sorted with | A month after posting |
| Closed ask | `CLOSED#<ask id>` | The same ask, plus how it ended | A month after posting |
| Dedupe record | `DEDUPE#<fingerprint>` | The id of the ask with that fingerprint | Ten minutes |
| Daily count | `USAGE#<date>` | How many asks the account has posted that day | A few days |

1. **Every item's partition key is the account id.** A handler takes that id from the verified token and from nowhere else.
2. **There are no secondary indexes and no scans.**
3. **Every read is strongly consistent.**
4. **An idle poll is one read.** The page sends the version it last saw. The service reads the account marker, and answers "nothing new" if the version matches.
5. **Open asks are listed by their key prefix.** Closed asks sit under a different prefix, so they never slow that read down.
6. **Posting an ask is one transaction.** It writes the dedupe record only if none is live, counts against the daily cap, writes the open ask and raises the version. If the dedupe write is refused, the service reads the record and returns the earlier id.
7. **Closing an ask is one transaction.** It removes the open item, writes the closed item and raises the version. Replacing an ask closes the old one and posts the new one in the same transaction, and the new one keeps the old one's posting time.
8. **Every change raises the version,** including a sort result arriving. That is how the page learns of it.
9. **Ask ids are long random values** ([ADR 2](0002-agents-write-only.md)). Because the key carries the account, another account's id is simply not found.
10. **One module builds every key.** No other code writes a key by hand. That module sits inside a single store module, which is the only code that reads or writes the table. Every write goes through one function in it, and that function raises the version itself.
11. **Expiry is checked on read** ([ADR 5](0005-hosting.md)), on every item that has one.
12. **Deleting an account is one query and a batch delete,** because everything it owns is in one partition.

How sorting is triggered stays an implementation detail, as the PRD says. The table supports either way: each ask records the rules version it was sorted with, and both triggers, a new ask and a change of rules, start from a single account's partition.

## Alternatives considered

1. **A table for each kind of item.** It is easier to read at a glance, and a transaction can span tables. Rejected: one partition per account gives isolation by key, one query to read an account and one to delete it. Separate tables would give none of that, for more resources to declare.
2. **Key each ask by its id alone.** An ask could be fetched by id with no account. Rejected: listing an account's asks would need an index, and keeping accounts apart would rest on a check in code, which can be forgotten.
3. **An index of open asks.** This is the common pattern, and the ask would keep one key for life. Rejected: an index is read a moment behind the table. The page could see the version change, read the index before it caught up, and then never ask again. An implementer is likely to suggest this, so it becomes a "Do not" in the constraint file.
4. **Keep closed asks in place, marked by a state field.** Rejected: every list of open asks would read a month of closed ones and filter them out.
5. **A relational database.** Rejected in [ADR 5](0005-hosting.md).

## Fitness functions

All eight run in CI and block a merge. The last five use the real local database ([ADR 9](0009-test-pyramid.md)).

| Check | What it asserts | What it catches |
| --- | --- | --- |
| One key builder | Lint forbids a key written anywhere but the key module, and the database client imported anywhere but the store module. | A hand-built key that leaves out the account, or a write that skips the version. |
| The account comes from the token | The key module accepts only an account id of a type that the token check alone can produce. | A key built from an id the caller supplied. |
| No index, no scan | A test reads the deployment definition and finds no secondary index. Lint forbids the scan call. | An index or a scan added for convenience. |
| Posting is atomic | Twenty identical asks sent at once leave one open ask, one count and one id. | A duplicate or a miscount under a race. |
| An idle poll is one read | A poll carrying the current version makes exactly one read, of the account marker. | An idle poll that quietly starts reading asks. |
| Every change raises the version | Posting, a sort result, closing, replacing and saving rules each raise it. | A change the page never learns of. |
| Accounts are apart | Resolving another account's ask id returns `not_found` and changes nothing. | A leak across accounts. |
| Expiry on read | An item past its expiry but still stored is treated as absent. | A stale dedupe record, or a month-old ask, coming back. |

## Consequences

**Easier**

- Accounts are kept apart by the key, with no check for anyone to forget.
- An idle poll costs one small read, however many asks exist.
- A read always sees the latest write, so the version check cannot miss an update.
- Deleting an account is one query.
- There is no index to pay for, or to wait on.

**Harder, and accepted**

- A transaction costs twice the write units of plain writes. At this scale that is pennies.
- An ask changes key when it closes. That is unusual, and finding an ask by id means looking under both prefixes.
- Every write must raise the version. The single write function does that, so a new kind of write has to be added there and nowhere else.
- The account marker is written on every change, so one account's writes queue on one item. That is fine for one person's asks.
- Nothing can be read across accounts. Overall numbers come from log queries ([ADR 8](0008-alerting.md)).
- Changing the keys later means moving the data.
