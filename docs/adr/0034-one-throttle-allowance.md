# ADR 34: The API's routes share one throttle allowance, and no route has its own

Decided on 14 October 2026: the throttle from [ADR 31](0031-api-throttle.md) is one allowance that all the API's routes share, 50 requests a second with bursts of 100 for the whole API. #398 measured this on the deployed API. The values stay. The arithmetic counts the allowance once, and no route sets a throttle of its own, so the one measured allowance is the only one. This amends points 2 and 6 of ADR 31, its rule on a route's own limit, and its consequence that a flood shuts accounts out of one route. Issue #398 asked for it.

Parent PRD: [PRD](../../PRD.md). Amends [ADR 31](0031-api-throttle.md).

## Constraint-set delta

Edits [`docs/constraints/api-throttle.md`](../constraints/api-throttle.md). The `Decision:` line says every route shares one allowance. The rule that planned for an allowance on each route now gives the arithmetic for one. The rule that no route sets a higher limit of its own becomes a rule that no route sets a throttle of its own. The rule on redoing the arithmetic says which change redoes which part. A new "Do not" entry rules out a throttle of its own for the poll's route, or any route. The `Judgment:` line says how #398 measured the sharing, and the `History:` line adds this record.

## Context

- **#398 measured one allowance.** On 14 October 2026, a script on one laptop sent the deployed API requests at fixed rates, on routes that need no token. One route alone at 40 a second got no 429. Two routes at 40 a second each, first on one path and then on two, both got API Gateway's 429 from about 3.5 seconds in. That is when one bucket of 100 runs dry, filling at 50 a second while 80 a second drain it. From then on, the two routes together got about 50 to 55 answers a second. The results are on #398.
- **ADR 31 planned for the worse reading.** It took each of the 12 routes to have its own allowance. A flood across them could then reach 600 requests a second, about $62 a day in request charges. With one allowance it reaches about 50 a second.
- **The cap is best effort.** Under a flood of 150 a second on one route, about 590 requests passed in 6 seconds, against 400 for an exact bucket. In the last four seconds, 60 to 90 a second still passed.
- **A route's own settings are unmeasured.** The stage also takes settings for one route, which replace the default for that route. AWS does not say whether such a route draws on the shared allowance or gets one of its own, and #398 did not measure it. ADR 31 lets a route set a limit of its own no higher than the default.

## Decision

The API's routes share one throttle allowance of 50 requests a second with bursts of 100, and no route sets a throttle of its own.

1. **The values stay.** Real use is still a few requests a second across all routes. 100 pages open at once, each polling every 5 seconds, come to 20 a second, and the poll is the only call the page repeats. Agents add little. 50 a second is still more than twice the most the demo sends steadily, now counted across every route. A burst of 100 still lets many pages that come back into view at once read without a 429.
2. **The arithmetic counts the allowance once.** A flood held at the cap reaches the function at about 50 requests a second. That is about 4.3 million a day, or about $5 a day in API Gateway and Lambda request charges, before the function's run time and logs. #398 saw up to 90 a second pass under a flood, so a day of it may cost up to about $9. A new route does not change these figures.
3. **No route sets a throttle of its own.** The stage sets `DefaultRouteSettings` and no `RouteSettings`. A route with settings of its own may get an allowance apart from the shared one. That would raise the total past item 2 with no value in item 2 changed. This replaces ADR 31's rule that a route may set a limit of its own no higher than the default.
4. **What redoes the arithmetic.** A pull request that adds a route, or makes the page or an agent call more often, redoes item 1: all real use, on every route together, against the one rate. One that raises a value also redoes item 2. This replaces ADR 31's item 6.
5. **The rest of ADR 31 stands.** API Gateway answers a request over the cap with its own 429, the page treats it as a failed request, and no alarm reads it.

## Alternatives considered

1. **Give the poll's route an allowance of its own.** A flood on another route would then not stop every page's list. Rejected: it would add the poll's own rate to what a flood can reach, if a route's own settings do give it an allowance, which #398 did not measure. A flood on the poll's own route would still stop the list. An implementer is likely to reach for it, so it becomes a "Do not".
2. **Lower the rate now that it is shared.** Rejected: real use can reach about 20 a second at 100 accounts, and a flood at 50 a second costs about $5 a day, which the spend alarm reports. A lower rate would save a few dollars a day during a flood, and bring 429s to real use sooner.
3. **Keep ADR 31's rule, which lets a route set a limit no higher than the default.** Rejected: under one shared allowance, a route's own limit may add a second allowance and raise the total, and ADR 31's check would pass it.

## Fitness functions

| Check | What it asserts | Where it runs | What it catches |
| --- | --- | --- | --- |
| No route has a throttle of its own | Read as YAML, `serverless.yml`'s extension of `HttpApiStage` sets no `RouteSettings`. | Gate (static) | A route given a throttle of its own, even one no higher than the default, which could add an allowance past the one #398 measured. |

The check lands with this record. ADR 31's two checks stand. Its static check still asserts that no route's settings go above the default, and this check is stricter.

No check can see that the deployed API still shares one allowance. That goes on the constraint file's `Judgment:` line, with #398's method.

## Consequences

**Easier**

- A flood held at the cap costs about $5 a day, or up to about $9 where the cap passes more, against ADR 31's $62.
- A new route does not raise what a flood costs.
- The poll needs no setting of its own.

**Harder, and accepted**

- A flood on any route shuts every account out of every route while it lasts, the MCP endpoint and the page's API alike. ADR 31 expected it to shut them out of the flooded route only.
- Real use on every route shares 50 a second. A new route the page calls often, or a shorter poll, takes from the same rate as the poll.
- A flood of 150 a second from one address passed up to 90 a second. A flood from many addresses may pass more, and #398 could not measure it.
- Lambda's concurrency limit can be reached before the cap holds. In the first 2 seconds of #398's flood, 99 requests got a 503 in about 90 ms. That fits Lambda refusing to start the function at the account's concurrency limit, as ADR 31 warned.
- Whether a route's own settings would get an allowance apart from the default's stays unmeasured. The rule against them leaves it moot until a route needs one.
