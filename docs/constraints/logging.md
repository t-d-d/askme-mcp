# Logging
Relevance: A log line, its level, its fields or its event name, or a new function: service/** emissions, the logger module, infra/** function definitions
Decision: Levels mean routing (error = alert, warn = review later, info = as designed); every line names an event; no user content is logged.

Why: Levels chosen by feel drift until the error alarm means nothing,
and asks, rules and links are private ([ADR 2](../adr/0002-agents-write-only.md)).

## Rules

- Every function logs JSON.
- Three levels, no debug. error = someone is alerted now. warn =
  handled but suspect. info = as designed, expected refusals included.
- Never raise a level to make something countable. Count by event.
- Every line names an event from the one exported list.
- No summary, area, spoken detail, link, rules text, hashtag name,
  email address or token in any line. Ids only.
- No model prompts or replies. Token counts and timings only.
- Log a dependency's error class and status, never its message.
- The shared logger is the only way to log.
- Every line carries the request id.

## Do not

- Log content and scrub it afterwards: a scrubber misses what it was
  not told about.
- Log an expected refusal at warn or error.
- Add a debug level or a content log for troubleshooting.

Judgment: Whether a line is error or warn is a judgement no check
can make.
History: [ADR 7](../adr/0007-logging.md)
