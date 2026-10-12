# ADR 21: Each account has a daily cap on model calls

Decided on 12 October 2026: every model call the service makes for an account is counted against that account's daily cap just before it is sent, and a call over the cap is not sent. The count is a rate counter of its own, under `MODEL#<window>`, written as [ADR 18](0018-rate-counter.md) says, with a window of one UTC day. Issue #89 asked for a bound on what saving the rules can spend, and this is the option the owner picked.

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

- Adds [`docs/constraints/model-call-cap.md`](../constraints/model-call-cap.md).
- Edits [`docs/constraints/table-design.md`](../constraints/table-design.md): the sort keys gain `MODEL#<window>` for the daily count of model calls.

## Context

- **Saving the rules multiplies model calls by the open asks.** A save reads the rules with one model call. It then hands every open ask to the sort function, and each sort makes up to two calls. The only limit is 10 saves a minute for each account. An account with 200 open asks that saves 10 times a minute starts 2,000 sorts a minute, and nothing stops it doing that all day.
- **An account can hold up to 3,000 open asks:** 100 a day, kept for 30 days.
- **The daily cap on asks does not reach this.** It limits what an account posts, not how often its asks are sorted again.
- **Every account shares the service's model key.** The key has a spending limit. One account that reaches it stops sorting for every account until the owner raises it.
- **No alarm sees model spend.** The spend alarm of [ADR 17](0017-spend-reads-the-bill.md) reads the AWS bill, and OpenRouter bills the model apart from AWS.

## Decision

Each account may make a fixed number of model calls in a UTC day, each counted just before it is sent.

1. **What counts.** Every model call the service makes for an account: the read of the rules when they are saved, and each try of a sort, up to two for one ask. A sort the sort function skips, because its ask is already sorted with the rules in force, sends nothing and counts nothing. Empty rules need no call, so they count nothing either.
2. **Where the count is kept.** A rate counter under the account's partition, with the sort key `MODEL#<window>`. The window is one UTC day, named by the minute it starts, as `MODEL#2026-10-12T00:00`. The key module builds the key. The counter function writes it, as one conditional update that never raises the version (ADR 18). The item expires an hour after its day ends.
3. **One place counts.** The service builds its model client in one module, and that module counts each call against the account's cap before sending it. Nothing else in the service builds a model client. Today `service/src/handler.ts` and `service/src/sorter.ts` each build one with `createModel`, and a call carries no account, so the issue that builds the cap moves both to the counting module and gives each call its account.
4. **A sort over the cap** sends no call. The ask keeps what it had: its old sort, or none yet. The sort function logs it at info, because the cap is working as designed, and does not fail. A sort whose first try fails at the model and whose second is refused at the cap still logs the model's failure at warn, as it does now. A later poll may hand the ask on again, and it stops at the cap again until the day ends. Each time costs a Lambda invoke and a few small writes, and no model call.
5. **A save over the cap** is refused with `cap_reached` before anything is saved, when its rules need reading. A save of empty rules makes no call, so the cap does not refuse it. The message gives the limit and the time it resets, as the ask cap's does. The page shows the words [design.md](../design.md) already gives for "The daily cap is reached", and the text the person typed stays in the box.
6. **A save under the cap** reads the rules and re-sorts every open ask, as before. If the cap runs out partway, the asks not yet sorted keep their old sort at least until the next UTC day, as the consequences below say.
7. **The cap never refuses an agent.** Posting an ask is not a model call, and its sort runs after the agent has its answer.
8. **The cap starts at 2,000 model calls a day for each account.** A day of normal use is up to 100 new asks, one call each when the first try succeeds, and a few saves over a few dozen open asks. That is a few hundred calls. The cap is a constant in `service/src/rate.ts`, beside the rate limits. Tuning it needs no new decision.
9. **The eval is outside the cap.** `npm run eval` calls the model from the repo, on the eval key, and touches no account.

## Alternatives considered

1. **Count each re-sort against the poll retry's limit, `SORT#`.** It needs no new counter. Rejected: that limit is 10 a minute, so a save would re-sort 10 asks at once and leave the rest to polls. Anyone with more than 10 open asks would wait minutes after saving. The PRD's "Saving re-sorts every open ask" would fail in normal use. A daily cap is reached only when an account is scripted.
2. **Lower the save limit.** One constant changes. Rejected: spend still grows with the open asks, so a lower limit narrows the problem and does not bound it.
3. **Hand the fan-out to the sort function.** The sort function has 60 seconds, where the API gives each invoke 1 second. Rejected as the answer to spend: it changes when sorts start, not how many there are. It may still fix the invokes that time out, which issue #89 also reports. That choice stays open, with the retry of issue #56.
4. **Count where an ask is handed to the sort function.** The API would count before each invoke, and the sort function would not change. Rejected: the sort function skips an ask already sorted with the rules in force, so many invokes send no call, and counting them would refuse work that costs nothing. It would also miss a sort's second try. An implementer is likely to put the count in the API's re-sort after a save, so it becomes a "Do not" in the constraint file.
5. **Keep the count on `USAGE#<date>`, beside the ask count.** It needs no new prefix. Rejected: posting writes that item inside a transaction that raises the version, and a count made by the sort function must not raise it (ADR 18). An item written by two paths is easy to break. Both are daily counts, so an implementer is likely to suggest this, and it becomes a "Do not".
6. **Rely on the model key's spending limit.** It needs no code. Rejected: the key is shared, so one account reaching its limit stops sorting for all. The key's limit still stops spending if the cap is set too high. An implementer is likely to point to it, so it becomes a "Do not".
7. **Sort several asks in one model call.** The same work would take fewer calls. Rejected: [`untrusted-ask-text.md`](../constraints/untrusted-ask-text.md) allows one account's rules and one of its asks in each call, so a hostile ask cannot reach another ask's sort. An implementer cutting spend is likely to reach for this, so it becomes a "Do not".
8. **Log a capped sort at warn, as a failed sort is.** The sort function already logs a failure there. Rejected: warn means review later ([`logging.md`](../constraints/logging.md)), and a capped sort is the cap working as designed. An implementer is likely to reuse the failed sort's line, so it becomes a "Do not".

## Fitness functions

All four run in the gate and block a merge. They land with the issue that builds the cap, because this record changes no code.

| Check | What it asserts | What it catches |
| --- | --- | --- |
| One module builds the model client | A static check refuses a model client built anywhere in `service/` but the module that counts calls. Test files and `evals/` are outside the check. | A new caller that reaches the model without counting. |
| A spent cap sends no call | With an account's count at the cap, saving the rules, posting an ask and a poll's retry reach the fake model no times. The save is refused with `cap_reached`, and the ask keeps its sort. | A path that skips the count, or counts after the call. |
| Each call counts once | After posts, a save, and a sort whose first try fails, the account's count equals the number of calls the fake model received. | A count made at hand-on, or a sort's second try left out. |
| A capped sort leaves the version alone | A sort refused at the cap leaves the account's version where it was. | The count sent through the write function, which raises the version. |

## Consequences

**Easier**

- An account can make at most 2,000 model calls a day, however it is scripted. While the Clerk development instance limits askme to 100 accounts, the whole service makes at most 200,000 a day. The owner can set that number against the key's limit.
- A new feature that calls the model is counted without extra work, because the only model client counts.

**Harder, and accepted**

- Above the cap, "Saving re-sorts every open ask" does not hold. The asks left over keep their old sort until the next UTC day. While issue #56 is open, they wait after that until something else changes on the account.
- An account with more open asks than the calls left in its day cannot re-sort all of them that day. The read of the rules, each sort's second try and the day's new asks draw on the same cap, so this can start well below 2,000 open asks.
- A person who reaches the cap cannot save rules that need reading until the next UTC day.
- Every model call adds a write to the table, and a refused one still costs a write unit.
- The sort function now writes a rate counter as well as the sort. A poll from the live tier can cause that write through a sort it asks for again. [ADR 20](0020-live-tier-reads.md) names only `POLL#<window>` and `SORT#<window>`, and says any other write a read comes to cause needs a decision. This record is that decision for `MODEL#<window>`. [`test-tiers.md`](../constraints/test-tiers.md) already lets the service write a rate counter to answer the live tier's reads, so its text needs no change.
