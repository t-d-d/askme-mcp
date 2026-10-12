# Table design
Relevance: Any read or write of the table, a new kind of stored item, or the table's definition: key module, store module, deployment definition
Decision: One table. The partition key is the account id from the token, the sort key names the item, with no indexes and no scans.

Why: Every read belongs to one account. Keying by account keeps
accounts apart, makes an idle poll one read, and avoids an index
that lags behind the table.

## Rules

- Sort keys: META, RULES, OPEN#<id>, CLOSED#<id>,
  DEDUPE#<fingerprint>, USAGE#<date>, and one prefix for each rate
  counter, followed by its window: POLL#<window> for polls,
  RATE#<window> for asks, SAVE#<window> for saving the rules and
  SORT#<window> for asking again for an ask not yet sorted with the
  rules in force.
- The account id in a key comes from the verified token only.
- One store module is the only code that reads or writes the table.
- Every change to asks or rules goes through one function, which
  raises the version.
- A rate counter is the only write outside it. One function writes
  it, as one conditional update, and never raises the version.
- One module, inside the store, builds every key.
- Every read is strongly consistent.
- Posting, closing and replacing are each one transaction.
- Every change to asks or rules raises the version on META.
- An idle poll reads META and nothing else. Its only write is its
  rate counter.
- Expiry is checked on read.
- A new kind of item gets its own prefix, added in the key module.

## Do not

- Add a secondary index: it lags, and the page can miss an update.
- Scan the table.
- Key an ask by its id alone.
- Keep closed asks under OPEN# with a state field.
- Write a key by hand outside the key module.
- Import the database client outside the store module.
- Change an ask or the rules without raising the version.
- Raise the version from a rate counter: every poll would change it,
  and no poll would be idle.
- Keep a rate count on META: META would change on every poll with
  the version left alone, and the count would need resetting in code.

Judgment: A need to read across accounts is a new ADR, not an
index.

History: [ADR 13](../adr/0013-table-design.md), [ADR 18](../adr/0018-rate-counter.md)
