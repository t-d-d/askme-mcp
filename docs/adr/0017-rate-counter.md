# ADR 17: A rate counter is written without raising the version

Decided on 11 October 2026: a rate counter is stored in the table, one item per account and time window, under its own key prefix. One function in the store writes it, as one conditional update, and that write does not raise the account's version. Every change to asks or rules still goes through the one write function, which raises the version. This replaces the words "Every write goes through one function" in point 10 of [ADR 13](0013-table-design.md), and the consequence there that "a new kind of write has to be added there and nowhere else". The rest of ADR 13 stands.

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

- Edits [`docs/constraints/table-design.md`](../constraints/table-design.md): the sort keys gain `POLL#<window>`. The one write function covers every change to asks or rules, not every write. A rate counter is the only write outside it, made by one function of its own, and it never raises the version. An idle poll's only write is its rate counter. Two new "Do not" entries: no rate counter raises the version, and no rate count is kept on `META`.

## Context

- **The poll endpoint needs its own rate limit.** [ADR 1](0001-polling.md) says so, because the daily cap on asks does not limit polls. Issue #8 builds it and stores its counter in the table under its own key prefix. Issue #10 stores the ask tool's rate counter the same way.
- **A stored counter means every poll writes.** Each poll adds one to the account's count before it is answered, so the count can refuse it.
- **ADR 13 sends every write through one function, which raises the version.** It did that so that no change to asks or rules could escape the version, because the version is how the page learns of a change. It was written before any write that changes nothing the page shows.
- **Raising the version on every poll ends idle polls.** The page compares the version it last saw. If its own poll raises the version, the next poll never matches and reads the whole list. With the page open on a phone and a laptop, each one's polls also make the other's polls full reads. ADR 1 and ADR 13 both want an idle poll to be one read.

## Decision

A rate counter has a write path of its own, and it never touches the version.

1. **Where it lives.** One item per account and window, under the account's partition. The poll's counter has the sort key `POLL#<window>`, where the window is named by its start, to the minute. The key module builds it, like every other key.
2. **How it is written.** One function in the store, and only that function, writes rate counters. Each call is one conditional update: add one if the count is under the limit. If the condition fails, the call is refused, and nothing is written. The function does not raise the version, and it writes nothing else.
3. **Everything else.** Every change to asks or rules goes through the one write function, which raises the version in the same transaction, as ADR 13 says.
4. **Expiry.** Each counter item expires an hour after its window ends. Expiry is still checked on read: the counter is only touched inside its own window, which ends before the item expires, so an expired counter is never counted.
5. **An idle poll.** It writes its counter, then reads `META` and nothing else. That is one write and one read.
6. **The limit.** The poll limit starts at 60 polls a minute for each account, which is well above what a page open on two devices sends. The limit and the window are constants in code. Tuning them needs no new decision.

## Alternatives considered

1. **Send the counter through the one write function, which raises the version.** It keeps ADR 13's wording as it is. Rejected: every poll would change the version, so no poll would ever be idle, and two open pages would turn each other's polls into full reads. An implementer following ADR 13's wording is likely to do this, so it becomes a "Do not" in the constraint file.
2. **Keep the count on `META`.** An idle poll would be one request: update the count and return the version in the same call. Rejected: `META` would be written on every poll without the version changing, which is the same exception made on the item that holds the version. Resetting the count at each new window would need code of its own, where a separate item per window expires by itself. ADR 13 also gives a new kind of item its own prefix. An implementer is likely to suggest this, so it becomes a "Do not" in the constraint file.
3. **Limit polls with API Gateway's route throttling,** with no stored counter. The table would not change. Rejected: the throttle is shared by every account, so one account's runaway page would refuse everyone's polls.
4. **Count polls in each Lambda instance's memory.** No write at all. Rejected: Lambda runs many instances and recycles them, so the count would be partial and would reset at random.

## Fitness functions

All three run in the gate and block a merge. They land with issue #8, which builds the poll's counter.

| Check | What it asserts | What it catches |
| --- | --- | --- |
| Two functions write | Lint refuses a write command built anywhere in the store but the one write function and the counter function. | A third write path, which might change an ask without raising the version. |
| A counter leaves the version alone | Polls counted against the limit leave the account's version where it was. | A counter sent through the write function. |
| An idle poll is one read | A poll carrying the current version reads `META` and nothing else, and writes nothing but its counter. | An idle poll that reads the list, or writes more than its counter. |

## Consequences

**Easier**

- The poll endpoint has a limit per account, held in the same table and keyed by the same account, with no new resource.
- Idle polls stay one read, however many devices are open.
- Issue #10's ask counter uses the same function.

**Harder, and accepted**

- Every poll is also a write. At five seconds a poll, an open page writes 720 times an hour, which costs a fraction of a cent.
- The store now has two write paths. A reader has to know which one a new write belongs to, and lint holds the line between them.
- A refused poll still costs a write unit, because DynamoDB charges for a failed conditional update.
- The window is fixed to the minute, so a burst across the edge of two windows can reach twice the limit for a moment.
