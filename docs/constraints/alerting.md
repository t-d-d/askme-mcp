# Alerting
Relevance: An alarm, a metric filter, the alert topic, a saved query or a new function: infra/** alarms and filters, queries/**
Decision: Four alarms, scoped to askme, all emailing the owner through one topic: error lines, function failures, server errors, spend.

Why: One owner needs few alerts that each mean act. An alarm on every
error line covers new code by construction (logging.md).

## Rules

- Every function has the error-level filter feeding the one metric.
- The alarm set is exactly: error lines, function failures, server
  errors, spend.
- Every alarm publishes to the one alert topic.
- No alarm reads an account-wide metric.
- An alarm description starts [tripwire] or [rate] and names the
  first query to run.
- Warnings are counted by query, never alarmed.
- Product numbers are saved queries in the repo, not metrics.

## Do not

- Add an alarm per feature: the net already covers it.
- Alarm on warnings: with no review routine it is noise.
- Route alerts through askme itself: an alert that askme is down
  cannot depend on askme.
- Fix a noisy alarm by weakening it. Change the level of the line.

Judgment: The email subscription is confirmed by hand and no check
can see it.
History: [ADR 8](../adr/0008-alerting.md)
