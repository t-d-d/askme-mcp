# Sort queue
Relevance: Handing an ask to the sort function, retrying or stopping a sort, the sort queue, or the sorting state the poll returns: jobs module, sort function, the poll, the rules save, the deployment definition
Decision: Sort jobs go through one FIFO queue, one group per ask, and read the rules in force when they run. A poll never starts a sort.

Why: A queue retries a failed sort whether or not a page is open,
without failing a run. One group per ask stops two jobs for the same
ask calling the model at once.

## Rules

- The FIFO queue is the sort function's only trigger.
- Posting an ask queues one job. Saving the rules queues one for each
  open ask, ten to a call. Nothing else queues a job.
- A job names the account and the ask. Its group is the ask. Its
  deduplication id is the account, the ask and the rules version it
  was queued under, and nothing reads that version back.
- A job for an ask already sorted with the rules in force ends before
  any model call.
- One message per run, and at most five runs at once. The visibility
  timeout is six times the sort function's timeout.
- The sort function never fails a run for a failed sort. It reports
  the message as failed, and the queue delivers it again.
- After the third delivery, the sort function logs at warn, marks the
  ask stopped and lets the message go. A later delivery is let go
  before any work.
- A save of unchanged text, whose last reading succeeded, reads
  nothing, leaves the rules version alone, records when it was made
  and queues every open ask.
- The poll's answer gives each ask one state: up to date, sorting or
  stopped. A stopped ask is behind the rules and was marked stopped
  after the rules were last saved.
- Only askme's role may send to the queue.

## Do not

- Retry a sort from the poll: a retry would need an open page and a
  change on the account.
- Use an ordinary queue: two jobs for one ask could run at once, and
  SQS may deliver one twice.
- Deduplicate on the ask alone: a second save within five minutes
  would lose its job.
- Let a job compare the version it was queued under: an older job
  would stop, and if the newer one is lost the ask stays on old rules.
- Throw from the sort function for a failed sort: it trips the
  function-failure alarm ([alerting.md](alerting.md)).
- Add a dead-letter queue and its alarm: one ask that never parses
  would email the owner.
- Hold a capped job on the queue until the reset: SQS delays a message
  by fifteen minutes at most.
- Raise the rules version on a save of unchanged text: every open ask
  would be sorted again.

Judgment: A new reason to sort an ask queues a job through the jobs
module. A new state for the page comes from what the table holds, not
from the queue.

History: [ADR 22](../adr/0022-sort-queue.md)
