# ADR 28: A sort the model refuses for askme's own key is not tried again

Decided on 14 October 2026: when the model refuses a sort's call for a fault of askme's own, the sort makes no second try and the sort function lets the job go on that delivery. The refused call still counts against the account's daily cap. Issue #351 found that a refused key spent six counted calls on each ask. The owner picked this option, and wanted the call taken back off the count only if that was simple. It is not, so it is left out. This amends point 6 of [ADR 22](0022-sort-queue.md), which has the queue deliver every failed sort again. The rest of ADR 21 and ADR 22 stands.

Parent PRD: [PRD](../../PRD.md). Amends point 6 of [ADR 22](0022-sort-queue.md).

## Constraint-set delta

- Edits [`docs/constraints/sort-queue.md`](../constraints/sort-queue.md): a new rule says a call the model refuses for askme's own key, credit, budget or model ends the sort with no second try, and the sort function logs it at error, logs the sort at warn and lets the message go on any delivery. The rule on a failure of askme's own names the table failing as its example, so the two rules do not read as one. A "Do not" entry is added against sending such a job back to the queue.
- Edits [`docs/constraints/model-call-cap.md`](../constraints/model-call-cap.md): a new rule says a call the model refuses still counts. A "Do not" entry is added against taking it back off the count.

## Context

- **A refused key fails every try the same way.** OpenRouter answers 401 for a refused key, 402 for spent credit, a 403 naming the limit for a spent budget, and 404 for a withdrawn model or when no provider meets askme's routing. The service already treats these as askme's own and logs them at error. None of them clears in the minutes between tries. The owner has to fix the key, the credit or the model.
- **Each try counts against the person's cap.** A sort tries twice in a delivery, and the queue delivers its job three times, so one ask spends six counted calls ([ADR 21](0021-model-call-cap.md), [ADR 22](0022-sort-queue.md)).
- **A save multiplies it.** A save whose reading is refused still saves the text and queues every open ask. With 300 open asks it spends 1,801 of the day's 2,000 calls, and "Try again" spends as many again. The person then sees `cap_reached` until the day ends, for a fault that was askme's.

## Decision

A model call refused for askme's own fault ends the sort, and the sort function lets the job go.

1. **Which faults.** The ones the service already counts as askme's own: 401, 402, a 403 naming a budget, and 404. A 403 without a budget can come from moderation of a hostile ask, and a 400 from the ask's text, so both stay ordinary failures and are tried again as before.
2. **In the sort.** On such a refusal the sort makes no second try, and the ask keeps what it had.
3. **In the sort function.** It logs the refusal at error, as before, then the failed sort at warn, and lets the message go on whichever delivery it is. It does not report the message as failed.
4. **The count.** The refused call was counted before it was sent, and it stays counted. So a refused key costs one call for each job: one for each ask posted, and one for each ask a save queues.
5. **After the fix.** The ask shows as stopped once its half hour has passed ([ADR 22](0022-sort-queue.md)). Once the key works, a save of unchanged text queues it again.
6. **Other failures.** Every other model failure, and every failure of askme's own such as the table failing, is still reported as failed and delivered again, up to the third delivery.

## Alternatives considered

1. **Take the refused call back off the count.** A refused key would then cost the person nothing. Rejected: the counter function makes one kind of write, adding one while the count is under the limit ([ADR 18](0018-rate-counter.md)). A refund needs a second kind of counter write in the one function lint allows, with its own tests. The owner said the cap need not be strict, and with no retry a refused key costs one call for each job. An implementer is likely to reach for this, so it becomes a "Do not" in `model-call-cap.md`.
2. **Count a call after its answer, and only when the model took it.** Nothing would need taking back. Rejected: counting before the send is what stops calls over the cap (ADR 21). Counted after, five sorts running at once could each pass the check and send.
3. **Drop only the second try, or only the later deliveries.** Rejected: every try fails the same way while the key is refused, so the ask would still spend three calls, or two, for nothing.
4. **Keep trying again, as for any failed sort.** It needs no code. Rejected: one save with a refused key can spend most of a person's day, as the context shows. It is what the code did, so it becomes a "Do not" in `sort-queue.md`.

## Fitness functions

It runs in the gate and blocks a merge. It lands with this record, in the integration tier.

| Check | What it asserts | What it catches |
| --- | --- | --- |
| A refused key is tried once | With the fake model answering 401, 402 or 404, a sort job calls the model once, the account's count goes up by one, and the job is let go on its first delivery with one error line and one warn line. | A second try, or a job sent back to the queue, for a fault no retry can fix. |

## Consequences

**Easier**

- A refused key costs a person one call for each ask, not six. The save in the context spends 301 calls, not 1,801.
- The owner gets one error line for each ask while the key is refused, not three.

**Harder, and accepted**

- A refused call still counts. A person who saves several times while the key is refused can still reach the cap, and then sees `cap_reached` until the day ends.
- An ask posted while the key is refused is not sorted on its own after the fix. It shows as stopped and waits for a save. Before, an ask whose last delivery came after the fix was sorted without one, within the twelve minutes its deliveries span.
- If OpenRouter ever refuses a key for a few minutes and then accepts it, the retries that would have caught that are gone.
