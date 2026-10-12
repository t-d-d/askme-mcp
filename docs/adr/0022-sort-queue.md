# ADR 22: Sort jobs go through a FIFO queue, and the poll only reads

Decided on 12 October 2026: the service hands an ask to the sort function through one SQS FIFO queue, with each ask as its own message group, in place of Lambda's asynchronous invoke. The queue retries a failed sort, so the poll no longer starts any sort. The poll reports the state of sorting instead, and the page shows it in one line. This replaces the poll's retry, which issue #56 found runs only when something else changes. It also settles the fan-out half of issue #89. It replaces the last two sentences of point 4 of [ADR 21](0021-model-call-cap.md), where a later poll hands a capped ask on again, and the part of point 2 of [ADR 20](0020-live-tier-reads.md) where the live tier's poll may ask for a sort. The rest of both records stands.

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

- Adds [`docs/constraints/sort-queue.md`](../constraints/sort-queue.md).
- Edits [`docs/constraints/hosting.md`](../constraints/hosting.md): the decision names SQS for sort jobs. "Every resource scales to zero" gains one exception: the requests Lambda makes to poll the sort queue, which AWS bills even when the queue is empty.
- Edits [`docs/constraints/polling.md`](../constraints/polling.md): a poll never starts a sort, and Lambda's polling of the sort queue is AWS's, not compute askme runs.
- Edits [`docs/constraints/table-design.md`](../constraints/table-design.md): `META` may hold the time the model-call cap resets, and an open ask may hold a mark that its sorting stopped. `SORT#<window>` leaves the sort-key list in the pull request that deletes the poll's retry, because the gate checks that the list names every key the key module builds.
- Edits [`docs/constraints/model-call-cap.md`](../constraints/model-call-cap.md): a sort the cap refuses marks its ask stopped, and the first refusal in a day records on `META` when the cap resets.
- Edits [`docs/constraints/test-tiers.md`](../constraints/test-tiers.md): the live tier's reads no longer cause a sort.

## Context

- **A failed sort is retried only by a poll that finds a change.** The sort function is set never to retry (`maximumRetryAttempts: 0` in `serverless.yml`), because a run that fails trips the function-failure alarm. So a poll asks again for asks still behind the rules. But a poll with nothing new returns before it reaches that code, and a failed sort changes nothing. Issue #56 records this. Each fix it lists bends a rule as written.
- **A save hands on every open ask at once.** Each hand-on is one Lambda invoke with a 1-second limit. With a few hundred open asks, some time out, and the poll retry is all that catches them. Issue #89 records this.
- **The page cannot say why a card keeps old hashtags.** Since ADR 21, the cap can leave asks on old rules for the rest of a day. The poll's answer gives each ask its sort or none, and does not say whether that sort is current, being redone, or stuck.
- **"Save rules" works only on changed text.** So a person whose asks were left behind cannot ask for them to be sorted again.

## Decision

Sorting runs from a queue that retries on its own. The poll only reads, and it tells the page how sorting stands.

1. **One FIFO queue.** It is the sort function's only trigger. The service no longer invokes the sort function directly.
2. **What queues a job.** Posting an ask queues one. Saving the rules queues one for each open ask, ten to a call. Nothing else queues a job, and a poll never does.
3. **What a job is.** It names the account and the ask. Its message group is the ask, so one ask's jobs run one after another, never at once. Its deduplication id is the account, the ask and the rules version the job was queued under. The sort function never reads that version back: it reads the rules in force when the job runs.
4. **A job already up to date ends at once.** When the ask is already sorted with the rules in force, the job ends before any model call and counts nothing against the cap. So when two saves land close together, an ask is sorted once with the newest rules.
5. **How jobs run.** One message per run, and at most five runs at once, to stay inside the model provider's rate limit. The queue's visibility timeout is six times the sort function's timeout, as AWS advises, so a retry comes about six minutes after a failure.
6. **A failed sort is retried by the queue.** The sort function never fails a run for a failed sort. It reports the message as failed, and the queue delivers it again. After the third delivery, the function logs the failure at warn, marks the ask as stopped, and lets the message go. A delivery past the third is let go before any work and logged at warn. There is no dead-letter queue and no new alarm.
7. **A sort the cap refuses** marks the ask as stopped, logs at info, and lets the message go. The first refusal in a day also records on `META` when the cap resets. Both writes go through the one write function and raise the version, so every open page learns of them.
8. **The poll only reads.** The poll's retry goes, with its `SORT#` counter and its limit. Its full answer gives each ask one of three states: up to date, sorting, or stopped. An ask is stopped when it is behind the rules and was marked stopped after the rules were last saved. The answer also gives the time the cap resets, while that time is still ahead.
9. **A save of unchanged text.** When the text is the same as the saved text and its last reading succeeded, the save makes no model call and leaves the rules version alone. It records when it was made, and queues every open ask again. The jobs for asks already up to date end at once, so only the stopped asks cost model calls. Within five minutes of a send for the same rules version, the queue drops the repeats. Since this save needs no reading, ADR 21 does not refuse it at the cap, but the page offers it only while the cap is not spent.
10. **The page shows one line about sorting.** It shows the cap while the cap is spent, then any asks still sorting, then any stopped, as [design.md](../design.md) sets out. "Save rules" also works on unchanged text while asks are stopped and the cap is not spent.
11. **Only askme's role may send to the queue.** The account a job names comes from the service that queued it.
12. **The idle cost is measured, not assumed.** Lambda polls the queue even when it is empty, and AWS bills those polls as SQS requests. No published figure says how many. The pull request that builds this checks the queue's `NumberOfEmptyReceives` metric after its deploy and records the cost. The spend alarm of [ADR 17](0017-spend-reads-the-bill.md) covers the bill.

## Alternatives considered

1. **Keep Lambda's asynchronous invoke, and retry from the poll.** No new resource. Rejected: a retry then needs an open page and a change on the account. Fixing that takes one of #56's options, each of which bends a rule: a poll that leaves out its version, an idle poll that reads the asks, or a count on `META` kept by every sort.
2. **Let Lambda retry the sort function itself,** with up to two retries. No queue. Rejected: Lambda retries only a run that fails, so every model failure would trip the function-failure alarm ([`alerting.md`](../constraints/alerting.md)).
3. **An ordinary SQS queue.** No ordering. Rejected: two jobs for one ask could run at the same moment, and both would call the model. SQS may also deliver one message twice. An implementer is likely to start with the default queue type, so it becomes a "Do not".
4. **Deduplicate on the ask alone.** A shorter id. Rejected: a second save within five minutes would lose its job, and an ask already sorted with the first rules would stay on them. It becomes a "Do not".
5. **Put the rules version in the job, and let an older job stop.** The newer job would do the work. Rejected: the older job stops on the assumption that the newer one runs. If the newer one is lost, the ask stays on old rules. When every job reads the rules in force, any job brings its ask up to date. It becomes a "Do not".
6. **A dead-letter queue, with an alarm.** A record of every sort that never worked. Rejected: it is a fifth alarm, and one hostile ask that never parses would email the owner. The warn line and the stopped mark record it instead. It becomes a "Do not".
7. **Hold a capped job on the queue until the cap resets.** Nothing would need a save. Rejected: SQS delays a message by at most fifteen minutes, so a capped job would cycle through the queue all day. It becomes a "Do not".
8. **Let a save of unchanged text raise the rules version.** It is what a save does today. Rejected: every open ask would then be behind the rules and sorted again, at one call each, where only the stopped asks need it. It becomes a "Do not".
9. **A separate "Sort them again" control,** with its own route. Rejected by the owner: an unchanged save does the same work through the existing route and its limit.

## Fitness functions

All run in the gate and block a merge. They land with the pull request that builds the queue, because this record changes no code. In the integration tier, a fake queue replaces the fake Lambda.

| Check | What it asserts | What it catches |
| --- | --- | --- |
| The queue is the only way to sorting | The sort function's only event is the FIFO queue, and no code in `service/` builds a Lambda client. | A direct invoke that skips the queue's order and retries. |
| A poll queues nothing | A poll that finds asks behind the rules, or stopped, sends nothing to the queue. | The poll's retry coming back. |
| An up-to-date job makes no call | After two saves, both jobs for one ask run, and the fake model is called once. | A job that sorts without checking the rules in force. |
| The deduplication id carries the rules version | Two jobs for one ask under different rules versions get different ids. Under the same version they get the same id. Each job's group is its ask. | A second save's jobs dropped as repeats, or two jobs for one ask running at once. |
| A failed sort never fails the run | With the model failing, the sort function reports the message as failed and does not throw. On the third delivery it lets the message go, marks the ask stopped and logs at warn. | A failed sort that trips the function-failure alarm, or retries for ever. |
| An unchanged save calls no model | A save of the same text leaves the rules version where it was, calls the fake model for no reading, and calls it only for stopped asks. | An unchanged save that re-sorts every open ask. |

## Consequences

**Easier**

- A failed sort is retried whether or not a page is open. The build closes #56.
- The poll only reads again. Its retry code, the `SORT#` counter and its limit go, and so does ADR 20's exception for a sort the live tier's poll asks for.
- A save sends its jobs ten to a call, a tenth of the calls it makes today.
- No model call is spent twice on one ask for the same rules, because one ask's jobs never run at once.
- The page can say why a card keeps old hashtags, and the person can ask for the stopped asks to be sorted again.

**Harder, and accepted**

- askme has a new resource, and it costs requests even when idle. The figure is unknown until the build measures it.
- A retry comes about six minutes after a failure, where the poll's came after one.
- A stopped ask waits for the person to save. Nothing sorts it again on its own, even after the cap resets.
- A job the cap refuses writes a mark on its ask. When the cap runs out partway through a save, every remaining job writes one, and each raises the version.
- Sorting 3,000 asks five at a time takes about ten minutes.
- The integration tier needs a fake queue in place of the fake Lambda.
