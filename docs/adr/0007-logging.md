# ADR 7: A log level says what happens next, and logs hold no user content

Decided on 9 October 2026: every log line is structured, with one of three levels, and the level says what happens when the line is written. An error alerts someone, a warning is counted for later review, and info is the service working as designed. No log line contains anything a user or an agent wrote.

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

Adds [`docs/constraints/logging.md`](../constraints/logging.md).

## Context

- **Levels drift.** When each log line's level is chosen by how bad it feels, errors stop meaning anything, and an alarm on them is either noisy or ignored.
- **An alarm on errors must be complete.** It is only worth having if every error line reaches it, whether or not the code threw.
- **The content is private.** Asks, rules and links describe someone's work and life. Logs are read by the owner and by agents helping to run the service, and they are kept by the cloud provider. The privacy rule in [ADR 2](0002-agents-write-only.md) has to reach the logs too.
- **Agents write the code.** They need a rule they can apply mechanically each time they add a log line.

## Decision

The level routes the line, the event names it, and an allowlist keeps content out.

1. **Every function logs JSON**, using the platform's JSON log format, so each line carries a level the platform stamps.
2. **Three levels, and no debug level.** The level answers one question: what happens when this line is written?

| Level | What happens | Use it for |
| --- | --- | --- |
| error | Someone is alerted now | An unhandled failure, a broken invariant, or a dependency failure that recovery did not absorb |
| warn | It is counted, and looked at in a routine review | Something handled, but suspect |
| info | Nothing | The service working as designed. That includes expected refusals: a call with no token, a rejected ask, a capped account, a deduplicated ask |

3. **A level is never raised to make something countable.** Counting uses the event name, not the level.
4. **Every line names an event.** Events are stable, lower-case, hyphenated names from one exported list, such as `ask-posted`, `ask-deduplicated`, `ask-sorted`, `sort-failed`, `ask-resolved` and `rules-saved`.
5. **No user content is logged.** That means no summary, area, spoken detail, link, rules text, hashtag name, email address or token. A line identifies things by id only: the account id and the ask id.
6. **Model traffic is not logged.** Prompts and replies contain content. Token counts and timings are logged.
7. **A dependency's error is logged by its class and status.** Its message is not logged, because it can echo what was sent.
8. **One logger is the only way to log.** It takes an event and a fixed set of named fields, so content cannot be passed in by accident.
9. **Every line carries the request id**, and lines about an ask carry its id, so one ask can be followed from post to sort to close.
10. **Logs are kept for 30 days**, the same as the data.
11. **The page sends no logs and no analytics** in version 1.

## Alternatives considered

1. **Severity levels chosen line by line.** This is what most code does. Rejected: the levels drift apart from what anyone does about them, and the error alarm loses its meaning.
2. **Log content, and scrub it.** A filter would remove sensitive parts before a line is written. Rejected: a scrubber misses what it was not told about. An allowlist cannot leak a field it never accepts. An implementer is likely to reach for this, so it becomes a "Do not" in the constraint file.
3. **A separate, restricted log of content for debugging bad sorts.** It would make a wrong sort easy to investigate. Rejected for version 1: a wrong sort is investigated with the eval set and with the reason stored on the ask, which its owner can already see.
4. **A third-party logging service.** Rejected: it is a new account, and it would send log lines to one more company.

## Fitness functions

All five run in CI and block a merge.

| Check | What it asserts | What it catches |
| --- | --- | --- |
| JSON everywhere | Every function in the deployment definition sets the JSON log format. | A function whose lines carry no level. |
| One way to log | Lint forbids `console` calls, and any logger but the shared one, in service code. | A line that goes round the allowlist. |
| Fields are allowlisted | The logger's type accepts only named fields, and none of the content field names is among them. | A content field being added to a log line. |
| Events are named | Every logger call passes an event from the one exported list. | Ad hoc event names that break counting. |
| No content reaches the output | A test posts an ask with a marker string in every content field, runs each handler including its failure paths, and finds no marker in any captured log line. | Content leaking through an error message or a dependency's reply. |

## Consequences

**Easier**

- An alarm on error lines means something, and it covers new code without anyone wiring it up.
- Anything can be counted by its event name, with no change to levels.
- Logs are safe to show to an agent, a reviewer or a support tool.

**Harder, and accepted**

- A bad sort cannot be diagnosed from logs alone. The logs give the ask's id and the timings, and the content has to be read from the store by someone entitled to see it.
- Whether a line is an error or a warning is a judgement, and no check can make it.
- An expected refusal is info, so a flood of refusals raises no error. Spotting that needs a rate alarm, which [ADR 8](0008-alerting.md) leaves out of version 1.
- A dependency's error message is sometimes the quickest clue, and it is not logged.
