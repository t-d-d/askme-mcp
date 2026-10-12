# Sort queue
Relevance: Handing an ask to the sort function, retrying or stopping a sort, the sort queue, or the sorting state the poll returns: jobs module, sort function, the poll, the rules save, the deployment definition
Decision: Sort jobs go through one FIFO queue, one group per ask, and read the rules in force when they run. A poll never starts a sort.

Why: A queue retries a failed sort whether or not a page is open,
without failing a run. One group per ask stops two jobs for the same
ask calling the model at once.

## Rules

- The FIFO queue is the sort function's only trigger.
- Posting an ask queues one job. Saving changed rules queues one for
  each open ask, ten to a call. Nothing else queues a job. A send the queue
  does not take is logged at warn.
- A job names the account and the ask. Its group is the ask. Its
  deduplication id is the account, the ask and the time of the post
  or save that queued it. The job reads the rules in force when it
  runs.
- A job for an ask already sorted with the rules in force ends before
  any model call.
- One message per run, and at most five runs at once, set as the
  queue trigger's maximum concurrency. The visibility timeout is six
  times the sort function's timeout.
- The sort function never fails a run for a failed sort. It reports
  the message as failed, and the queue delivers it again. A failure of
  askme's own is logged at error and reported the same way.
- After the third delivery, the sort function logs at warn and lets
  the message go. A later delivery is let go before any work.
- A save of unchanged text, whose last reading succeeded, reads
  nothing, leaves the rules version alone, records when it was made
  and queues only the asks behind the rules in force. It is refused
  while the cap is spent.
- The poll's answer gives each ask one state, worked out from the
  table: up to date when sorted with the rules in force, sorting when
  behind them for less than half an hour since the later of its
  posting and the last save, and stopped after that.
- Only askme's role may send to the queue.

## Do not

- Retry a sort from the poll: a retry would need an open page and a
  change on the account.
- Use an ordinary queue: two jobs for one ask could run at once, and
  SQS may deliver one twice.
- Deduplicate on the ask, or the ask and the rules version: a second
  save, or a save of unchanged text, within five minutes would lose
  its jobs.
- Let a job compare the version it was queued under: an older job
  would stop, and if the newer one is lost the ask stays on old rules.
- Write a mark when sorting stops: an ask whose job was lost would
  carry none, and at the cap every refused job would write one.
- Throw from the sort function for a failed sort: it trips the
  function-failure alarm ([alerting.md](alerting.md)).
- Add a dead-letter queue and its alarm: one ask that never parses
  would email the owner.
- Hold a capped job on the queue until the reset: a FIFO queue cannot
  delay one message, a received one stays hidden for twelve hours at
  most, and while hidden it holds back newer jobs for its ask.
- Limit the sort function with reserved concurrency: a throttled run
  trips the function-failure alarm.
- Raise the rules version on a save of unchanged text: every open ask
  would be sorted again.

Judgment: A new reason to sort an ask queues a job through the jobs
module. A new state for the page comes from what the table holds, not
from the queue.

History: [ADR 22](../adr/0022-sort-queue.md)
