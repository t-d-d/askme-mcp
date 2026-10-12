# ADR 22: Sort jobs go through a FIFO queue, and the poll only reads

Decided on 12 October 2026: the service hands an ask to the sort function through one SQS FIFO queue, with each ask as its own message group, in place of Lambda's asynchronous invoke. The queue retries a failed sort, so the poll no longer starts any sort. The poll reports the state of sorting instead, and the page shows it in one line. This replaces the poll's retry, which issue #56 found runs only when something else changes. It also settles the fan-out half of issue #89.

From [ADR 21](0021-model-call-cap.md) it replaces these parts. In point 4, the last two sentences, where a later poll hands a capped ask on again. In point 6, the words "at least until the next UTC day": an ask the cap leaves out now waits for a save after the reset. In the first "Harder" consequence, the last two sentences, for the same reason. In the fitness function "A spent cap sends no call", the words "and a poll's retry". The fitness function "A capped sort leaves the version alone", because the first sort the cap refuses each day now records the reset time through the write function; the count itself still never raises the version. In the last consequence, the sentence that says a poll from the live tier can cause a sort. From [ADR 20](0020-live-tier-reads.md) it replaces each place where the live tier's poll may ask for a sort: the words about a sort in the second sentence of the lead, the second sentence of point 2, and the second "Harder" consequence. The rest of both records stands.

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

- Adds [`docs/constraints/sort-queue.md`](../constraints/sort-queue.md).
- Edits [`docs/constraints/hosting.md`](../constraints/hosting.md): the decision names SQS for sort jobs. "Every resource scales to zero" and the "Do not" on a fixed monthly cost gain one exception: the requests Lambda makes to poll the sort queue, which AWS bills even when the queue is empty.
- Edits [`docs/constraints/polling.md`](../constraints/polling.md): a poll never starts a sort, and Lambda's polling of the sort queue is AWS's, not compute askme runs. Its "Why" allows the same idle requests.
- Edits [`docs/constraints/table-design.md`](../constraints/table-design.md): `META` may hold the time the model-call cap resets. `SORT#<window>` leaves the sort-key list in the pull request that deletes the poll's retry, because the gate checks that the list names every key the key module builds.
- Edits [`docs/constraints/model-call-cap.md`](../constraints/model-call-cap.md): the first sort the cap refuses in a day records on `META` when the cap resets, and a save of unchanged text is refused while the cap is spent.
- Edits [`docs/constraints/test-tiers.md`](../constraints/test-tiers.md): the live tier's reads no longer cause a sort.

## Context

- **A failed sort is retried only by a poll that finds a change.** The sort function is set never to retry (`maximumRetryAttempts: 0` in `serverless.yml`), because a later poll asks again. It also never fails a run for a failed sort, since a run that fails trips the function-failure alarm, so Lambda would have nothing to retry. So a poll asks again for asks still behind the rules. But a poll with nothing new returns before it reaches that code, and a failed sort changes nothing. Issue #56 records this. Each fix it lists bends a rule as written.
- **A save hands on every open ask at once.** Each hand-on is one Lambda invoke with a 1-second limit. With a few hundred open asks, some time out, and the poll retry is all that catches them. Issue #89 records this.
- **The page cannot say why a card keeps old hashtags.** Since ADR 21, the cap can leave asks on old rules for the rest of a day. The poll's answer gives each ask its sort or none, and does not say whether that sort is current, being redone, or stuck.
- **"Save rules" wakes only when the text changes.** The one unchanged save the page sends is "Try again" after a failed reading, which reads the rules again and raises the version. So a person whose asks were left behind cannot ask for only those to be sorted again.

## Decision

Sorting runs from a queue that retries on its own. The poll only reads, and it tells the page how sorting stands.

1. **One FIFO queue.** It is the sort function's only trigger. The service no longer invokes the sort function directly.
2. **What queues a job.** Posting an ask queues one. Saving changed rules queues one for each open ask, ten to a call, and a save of unchanged text queues fewer (point 9). Nothing else queues a job, and a poll never does. A send the queue does not take is logged at warn, and its ask shows as stopped once its time is up (point 8).
3. **What a job is.** It names the account and the ask. Its message group is the ask, so one ask's jobs run one after another, never at once. Its deduplication id is the account, the ask and the time of the post or save that queued it. So a send repeated by a retry is dropped, and a later post or save always gets through. The sort function reads the rules in force when the job runs.
4. **A job already up to date ends at once.** When the ask is already sorted with the rules in force, the job ends before any model call and counts nothing against the cap. So when two saves land close together, an ask is sorted once with the newest rules.
5. **How jobs run.** One message per run, and at most five runs at once, to stay inside the model provider's rate limit. The limit is the queue trigger's maximum concurrency, not the function's reserved concurrency, because a throttled run trips the function-failure alarm. The queue's visibility timeout is six times the sort function's timeout, as AWS advises, so a retry comes about six minutes after a failure.
6. **A failed sort is retried by the queue.** The sort function never fails a run for a failed sort. It reports the message as failed, and the queue delivers it again. A failure of askme's own, such as the table failing, is logged at error and reported the same way. After the third delivery, the function logs the failure at warn and lets the message go. A delivery past the third is let go before any work. There is no dead-letter queue and no new alarm.
7. **A sort the cap refuses** logs at info and lets the message go. The first sort the cap refuses in a day also records on `META` when the cap resets. That write goes through the one write function and raises the version, so every open page learns of it.
8. **The poll only reads.** The poll's retry goes, with its `SORT#` counter and its limit. Its full answer gives each ask one of three states, worked out from the table with nothing written for them:
   - **Up to date:** sorted with the rules in force.
   - **Sorting:** behind the rules, and less than half an hour has passed since the later of its posting and the last save.
   - **Stopped:** behind the rules, and that half hour has passed.

   Half an hour is longer than three deliveries six minutes apart take, with room for a queue that is working through a save. The answer also gives the time the cap resets, while that time is still ahead.
9. **A save of unchanged text.** When the text is the same as the saved text and its last reading succeeded, the save makes no model call and leaves the rules version alone. It records when it was made, and queues only the asks behind the rules in force. While the cap is spent it is refused with `cap_reached`, as a save that needs reading is.
10. **The page shows one line about sorting.** It shows the cap while the cap is spent, then any asks still sorting, then any stopped, as [design.md](../design.md) sets out. "Save rules" also works on unchanged text while asks are stopped and the cap is not spent.
11. **Only askme's role may send to the queue.** The account a job names comes from the service that queued it.
12. **The idle cost is measured, not assumed.** Lambda polls the queue even when it is empty, and AWS bills those polls as SQS requests. No published figure says how many. The pull request that builds this checks the queue's `NumberOfEmptyReceives` metric after its deploy and records the cost. The spend alarm of [ADR 17](0017-spend-reads-the-bill.md) covers the bill.

## Alternatives considered

1. **Keep Lambda's asynchronous invoke, and retry from the poll.** No new resource. Rejected: a retry then needs an open page and a change on the account. Fixing that takes one of #56's options, each of which bends a rule: a poll that leaves out its version, an idle poll that reads the asks, or a count on `META` kept by every sort.
2. **Let Lambda retry the sort function itself,** with up to two retries. No queue. Rejected: Lambda retries only a run that fails, so every model failure would trip the function-failure alarm ([`alerting.md`](../constraints/alerting.md)).
3. **An ordinary SQS queue.** No ordering. Rejected: two jobs for one ask could run at the same moment, and both would call the model. SQS may also deliver one message twice. An implementer is likely to start with the default queue type, so it becomes a "Do not".
4. **Deduplicate on the ask, or on the ask and the rules version.** No time in the id. Rejected: the queue drops a repeated id for five minutes. On the ask alone, a second save within five minutes would lose its jobs. With the rules version, a save of unchanged text keeps the version, so its jobs would be lost within five minutes of the last send. It becomes a "Do not".
5. **Put the rules version in the job, and let an older job stop.** The newer job would do the work. Rejected: the older job stops on the assumption that the newer one runs. If the newer one is lost, the ask stays on old rules. When every job reads the rules in force, any job brings its ask up to date. It becomes a "Do not".
6. **Mark an ask stopped when its sorting gives up.** The poll would read the mark. Rejected: an ask whose job was never taken, or was lost, would carry no mark and show "sorting" for ever. At the cap, every refused job would write a mark and raise the version. Working the state out from the ask's age covers every way a job can be lost, and writes nothing. It becomes a "Do not".
7. **A dead-letter queue, with an alarm.** A record of every sort that never worked. Rejected: it is a fifth alarm, and one hostile ask that never parses would email the owner. The warn line records it instead. It becomes a "Do not".
8. **Hold a capped job on the queue until the cap resets.** Nothing would need a save. Rejected: a FIFO queue cannot delay one message, and SQS hides a received message for at most twelve hours. So a capped job would come round again before the reset, and each return costs a run. While it is hidden, it also holds back any newer job for its ask. It becomes a "Do not".
9. **Let a save of unchanged text raise the rules version.** It is what a save does today. Rejected: every open ask would then be behind the rules and sorted again, at one call each, where only the stopped asks need it. It becomes a "Do not".
10. **A separate "Sort them again" control,** with its own route. Rejected by the owner: an unchanged save does the same work through the existing route and its limit.

## Fitness functions

All run in the gate and block a merge. They land with the pull request that builds the queue, because this record changes no code. In the integration tier, a fake queue replaces the fake Lambda.

| Check | What it asserts | What it catches |
| --- | --- | --- |
| The queue is the only way to sorting | The sort function's only event is the FIFO queue, and no code in `service/` builds a Lambda client. | A direct invoke that skips the queue's order and retries. |
| A poll queues nothing | A poll that finds asks behind the rules, sorting or stopped, sends nothing to the queue. | The poll's retry coming back. |
| An up-to-date job makes no call | After two saves, both jobs for one ask run, and the fake model is called once. | A job that sorts without checking the rules in force. |
| Each send has its own id | Two sends for one ask from different saves, a save of unchanged text included, get different deduplication ids. A repeat of one send gets the same id. Each job's group is its ask. | A later save's jobs dropped as repeats, or two jobs for one ask running at once. |
| A failed sort never fails the run | With the model failing, the sort function reports the message as failed and does not throw. On the third delivery it lets the message go and logs at warn. | A failed sort that trips the function-failure alarm, or retries for ever. |
| Stopped is worked out, not written | An ask behind the rules reads as sorting, then as stopped once half an hour has passed since the later of its posting and the last save, with nothing written to it. | A state that depends on a job having run. |
| An unchanged save calls no model | A save of the same text leaves the rules version where it was, calls the fake model for no reading, and queues only the asks behind the rules. While the cap is spent it is refused. | An unchanged save that re-sorts every open ask, or runs past the cap. |

## Consequences

**Easier**

- A failed sort is retried whether or not a page is open. The build closes #56.
- The poll only reads again. Its retry code, the `SORT#` counter and its limit go, and so does ADR 20's exception for a sort the live tier's poll asks for.
- A save sends its jobs ten to a call, a tenth of the calls it makes today.
- No model call is spent twice on one ask for the same rules, because one ask's jobs never run at once.
- The page can say why a card keeps old hashtags, and the person can ask for the stopped asks to be sorted again.
- However a job is lost, its ask shows as stopped within half an hour, and a save picks it up.

**Harder, and accepted**

- askme has a new resource, and it costs requests even when idle. The figure is unknown until the build measures it.
- A retry comes about six minutes after a failure, where the poll's came after one.
- A stopped ask waits for the person to save. Nothing sorts it again on its own, even after the cap resets.
- The state is judged by time. An ask still being tried after half an hour shows as stopped, and a save then queues it again, which is harmless.
- Sorting 3,000 asks five at a time, at about a second a sort, takes about ten minutes.
- The integration tier needs a fake queue in place of the fake Lambda.
