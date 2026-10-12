# Model call cap
Relevance: A model call, a new caller of the model, or the daily cap on model calls: the model client, the sort function, the rules read, the rate module, the store's counters
Decision: Every model call is counted against the account's daily cap just before it is sent. A call over the cap is not sent.

Why: Saving the rules multiplies model calls by the open asks, and
every account shares one model key. Without a cap for each account,
one scripted account could spend the key's limit and stop sorting
for everyone.

## Rules

- Every model call the service makes for an account counts against
  that account's cap: the rules read and each try of a sort.
- One module builds the model client, and it does the counting.
  Nothing else in the service builds one.
- A call is counted just before it is sent, once for each try.
- The count is a rate counter (ADR 18) under MODEL#<window>, where
  the window is one UTC day.
- The cap is a constant in the rate module. Tuning it needs no new
  decision.
- Over the cap, a sort sends nothing, leaves the ask as it was, and
  logs at info. A model failure on an earlier try is still logged at
  warn.
- The first call the cap refuses in a day, a sort's or a save's,
  records on META when the cap resets, through the write function. A
  refused save still saves none of the rules.
- Over the cap, a rules save whose rules need reading is refused
  with cap_reached before anything is saved. Empty rules make no
  call, so their save is not refused. A save of unchanged text that
  is not empty is refused while the cap is spent
  ([sort-queue.md](sort-queue.md)).
- The cap never refuses an agent.
- The eval is outside the cap. It runs from the repo, on its own key.

## Do not

- Count where an ask is handed to the sort function: the sort
  function skips an ask already sorted, so the count would refuse
  work that costs nothing, and it would miss a second try.
- Keep the count on USAGE#<date>: posting writes that item in a
  transaction that raises the version, and a count must not.
- Sort several asks in one call to save calls: each call carries one
  account's rules and one of its asks
  ([untrusted-ask-text.md](untrusted-ask-text.md)).
- Treat the model key's own limit as the cap: every account shares
  it, so one account reaching it stops sorting for all.
- Log a capped sort at warn, as a failed sort is: the cap is working
  as designed.

Judgment: A model call made for no account is a new decision. The
cap's value is the owner's call, set against the key's limit across
every account.

History: [ADR 21](../adr/0021-model-call-cap.md), [ADR 22](../adr/0022-sort-queue.md)
