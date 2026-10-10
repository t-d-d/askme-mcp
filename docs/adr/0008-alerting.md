# ADR 8: One net for errors, a few alarms, and alerts by email

Decided on 9 October 2026: the service is watched by a small, fixed set of alarms. One fires on any error-level log line from any function. The others catch failures that never write a line, and runaway cost. Every alarm emails the owner. There is no dashboard in version 1.

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

Adds [`docs/constraints/alerting.md`](../constraints/alerting.md).

## Context

- **One person owns a small service.** An alert is only useful if there are few of them and each one means "act".
- **[ADR 7](0007-logging.md) makes the error level mean something.** So one alarm on every error line covers every function, with nothing to wire up when a feature is added.
- **Some failures never write a line.** A timeout, running out of memory, a crash at start-up and throttling all leave no error line behind.
- **Cost can run away quietly.** Sign-up is open, and every ask costs a model call.
- **The cloud account may hold other systems.** A signal measured across the whole account would mix them up.
- **Alarms are billed each. Quiet metrics and stored queries are not.**

## Decision

There are four alarms, one topic and one inbox.

| Alarm | Fires when | What it covers |
| --- | --- | --- |
| Error lines | Any function writes an error-level line | Every failure the code noticed. This includes giving up on sorting an ask, which is logged as an error |
| Function failures | An askme function reports an error, a timeout or a throttle | Failures that never write a line |
| Server errors | The API returns server errors above a set rate | The service failing for users in a way neither of the first two saw |
| Spend | The month's cloud cost passes a set amount | Runaway cost |

1. **Each function has one filter on the error level**, feeding one metric. The error-lines alarm reads that metric. A new function is covered as soon as it is declared.
2. **Alarms are scoped to askme.** No alarm reads a metric measured across the whole account.
3. **Warnings are counted, not alarmed.** There is no review routine yet for an alarm to feed.
4. **Every alarm publishes to one topic, and the topic emails the owner.** There is no paging service and no text message.
5. **Each alarm's description says what kind it is and what to do first.** It starts with `[tripwire]` for any occurrence or `[rate]` for a rate, and names the log query to run.
6. **The model key has its own spending limit**, set at the model provider. OpenRouter allows a limit on a single key. The daily cap on asks per account sits in front of that.
7. **Product numbers come from saved queries, not metrics.** Asks posted, asks deduplicated, how asks ended, sorting time and tokens used are each a log query kept in the repo.
8. **There is no dashboard and no tracing in version 1.** A request passes through two hops, and the request id in every line ties them together.

## Alternatives considered

1. **An alarm for each feature or failure.** Each alarm would say exactly what broke. Rejected: someone has to remember to add one with every feature, and the one that was forgotten is the one that matters. The net covers new code by construction.
2. **Alarm on warnings too.** Rejected: with no routine for reviewing them, a warning alarm is noise, and noise teaches the owner to ignore the inbox. An implementer is likely to suggest this, so it becomes a "Do not" in the constraint file.
3. **Deliver alerts through askme itself.** It is, after all, a list of things that need the owner's attention. Rejected: an alert that askme is broken cannot depend on askme. It could become a second channel later.
4. **A third-party monitoring or paging service.** Rejected: it is a new account, and email is enough for a demo with one owner.
5. **A dashboard.** Rejected for version 1: nobody would watch it. A saved query answers a question when someone has one.

## Fitness functions

All five run in CI and block a merge.

| Check | What it asserts | What it catches |
| --- | --- | --- |
| Every function is in the net | Each function in the deployment definition has the error-level filter, feeding the one metric the alarm reads. | A new function whose errors alert nobody. |
| Every alarm reaches the topic | Each alarm's action is the one alert topic. | An alarm that fires to no one. |
| Alarms are scoped | No alarm reads a metric measured across the whole account. | Another system in the same account tripping askme's alarms. |
| The alarm set is the declared set | The alarms in the deployment definition are exactly the four named in the constraint file. | An alarm added or dropped without a decision. |
| Saved queries use real events | Each saved query refers only to events in the exported list. | A query that counts an event since renamed, and so returns nothing. |

## Consequences

**Easier**

- New code is covered without any wiring.
- There are few alarms, and each one means "act".
- The running cost is close to nothing.

**Harder, and accepted**

- One alarm for every error does not say which error. The first step is always a log query, which is why the alarm's description names it.
- Warnings can pile up unseen, because nothing prompts a review.
- Email is slow, and nobody is woken at night. That is acceptable for a demo.
- Without a dashboard there are no charts over time. A question is answered by running a query.
- The owner confirms the email subscription by hand, once. That step is outside the repo, and it is written down in the README.
- A flood of refused calls raises no alarm. The rate limit and the caps are the defence in version 1.
