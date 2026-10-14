# ADR 30: API Gateway caps the API's total request rate

Decided on 14 October 2026: API Gateway throttles every request to the API, across all accounts and routes, at 50 a second with bursts of 100. A request over the limit gets API Gateway's own 429 and starts no function, so it reaches no tool and carries none of askme's six refusal codes. The page treats it as any failed request. No alarm reads it. The spend alarm stays the alert for a flood, and API Gateway's request and 4xx counts are where the owner sees one. Issue #392 asked for it.

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

- Adds [`docs/constraints/api-throttle.md`](../constraints/api-throttle.md).
- Edits [`docs/constraints/error-contract.md`](../constraints/error-contract.md). The rule that a failure before the token is checked gets a 503 now says it is a failure in the handler, as [ADR 24](0024-failure-before-a-tool-runs.md) item 1 already did. A new rule says a request over the API's rate gets API Gateway's 429, which askme does not shape. A "Do not" entry is added against shaping it into a refusal, the `Judgment:` line names it, and this record is on the `History:` line. The rest of ADR 11 and ADR 24 stands.

## Context

- **Every limit is per account.** The per-minute limits in `service/src/rate.ts` and the daily caps on asks and model calls each count one account's requests, inside the function. A request without a valid token counts against none of them. Nothing limits the total rate, or the rate from one address.
- **Every request that reaches the function costs money, signed in or not.** API Gateway charges about $1 a million for an HTTP API, and Lambda $0.20 a million plus the function's run time. The function also writes log lines, which CloudWatch bills as it takes them in.
- **A flood had two bounds.** The account's Lambda concurrency limit, which may be 10 on a new account, shuts out real users once a flood reaches it. The spend alarm reads a bill that AWS updates about every six hours.
- **A firewall cannot help yet.** AWS WAF cannot attach to an HTTP API. Agents reach the MCP endpoint at API Gateway's own address, which also answers the page's API without passing through CloudFront, so a firewall on CloudFront would not see them.
- **API Gateway can throttle a stage.** An HTTP API stage takes a default rate and burst for every route. Over them, API Gateway answers 429 itself and does not call the function. AWS's pricing page says it does not charge for a request it throttles. Version 4.43.0 of the Serverless Framework builds the stage, as `HttpApiStage`, and has no setting for its throttle.

## Decision

API Gateway throttles the whole API at 50 requests a second with bursts of 100, before any request reaches askme's code.

1. **Where it is set.** `serverless.yml` extends the framework's stage through `resources.extensions.HttpApiStage`, with `DefaultRouteSettings` that set `ThrottlingRateLimit` to 50 and `ThrottlingBurstLimit` to 100. The framework copies each of an extension's properties over its own, without merging inside them, so the block replaces the framework's `DefaultRouteSettings` whole. It repeats `DetailedMetricsEnabled: false`, the one setting the framework writes there. A throttle has no fixed monthly cost, so it fits [hosting.md](../constraints/hosting.md).
2. **The values.** API Gateway lets a burst of up to 100 requests through, and refills that allowance at 50 a second.
   - Real use is a few requests a second. The Clerk instance holds at most 100 accounts, and 100 pages open at once, each polling every 5 seconds, come to 20 a second. An ask is a few requests and each account may post 100 a day, so agents add little.
   - 50 a second is more than twice the most the demo can send steadily. A burst of 100 lets many pages that come back into view at once read without a 429.
   - At the cap, at most about 4.3 million requests a day reach the function. API Gateway and Lambda charge about $1.20 a million between them for requests, so a flood held at the cap adds about $5 a day in request charges, before the function's run time and logs.
   - Before the cap, Lambda's concurrency was the bound. On AWS's default of 1,000 at once, that allows thousands of requests a second.
3. **What an agent gets.** A call over the limit gets HTTP status 429 with API Gateway's own body, `{"message":"Too Many Requests"}`, and no JSON-RPC message. It is not one of askme's six codes, and it is not a tool result. It is a failure before a tool runs, so it falls under [ADR 24](0024-failure-before-a-tool-runs.md): the call gets no tool result, and whoever holds the call when it fails answers it. Here that is API Gateway, before the handler. ADR 24's 503 covers a request that reached the handler, and a throttled request never does. An MCP client reports the 429 as an error of its own, and the agent still asks in its own session, as for any failure of askme ([ADR 11](0011-error-contract.md)).
4. **What the page shows.** The page's API is throttled with the MCP endpoint, whether its requests come through CloudFront or not. The page reads a 429 without one of askme's codes as a failed request. A read, such as the poll, shows "Not connected. Trying again." and tries again every five seconds, and the note goes with the first read that passes. A save the person makes, such as their rules or a dismissal, says it did not go through, and the person tries again.
5. **How a flood is seen.** A throttled request starts no function, so it writes no log line, and no alarm reads 4xx answers. The spend alarm is the alert. With the cap, a flood can only raise the bill at the rate in item 2, and the alarm reads the bill within about six hours of each update. When it fires, its first query, `askme/lines-by-event`, shows the requests that passed, such as `token-missing` lines for requests without a token. API Gateway's `Count` and `4xx` metrics for the API show the whole flood, throttled requests included. AWS records them for every HTTP API at no charge. No alarm reads them. A flood held at the cap costs little, and the owner can do nothing about it but wait, so its alert would not mean act ([alerting.md](../constraints/alerting.md)).
6. **A change to the values.** A pull request that raises either value, or that makes the page or an agent call more often, such as a shorter poll, redoes the arithmetic in item 2.

## Alternatives considered

1. **Count the total rate, or each address's rate, in the handler.** It would sit beside the per-account limits. Rejected: a request the function counts has already started the function, which is the cost being capped. A count by address would also need an item keyed by something other than an account, which [table-design.md](../constraints/table-design.md) rules out. An implementer is likely to reach for it, so it becomes a "Do not".
2. **AWS WAF with a rate-based rule.** It limits each address, not just the total. Rejected for now: WAF cannot attach to an HTTP API, and a firewall on CloudFront misses agents, which call API Gateway's own address. Turning that address off needs a custom domain. A web ACL also costs a fixed amount each month, which hosting.md rules out.
3. **A REST API in place of the HTTP API.** It takes WAF, per-client throttles, and gateway responses that could give the 429 askme's body. Rejected: it costs $3.50 a million requests against $1.00, every route would move, and a gateway response could still not be a tool result.
4. **Reserved concurrency on the `mcp` function.** It caps how many requests run at once, with no change to API Gateway. Rejected: API Gateway still calls the function and bills each request, every throttled run trips the function-failures alarm, and the caller gets a server error, not a 429. It also takes concurrency from the pool the sort function shares. This becomes a "Do not".
5. **An alarm on the API's 4xx count.** The owner would hear of a flood the bill does not show. Rejected: the count includes every 401 from an expired token, so its threshold would be a guess. [alerting.md](../constraints/alerting.md) fixes the set at four alarms that each mean act, and the owner can only wait out a flood held at the cap. This becomes a "Do not".
6. **Access logs on the stage, so a throttled request writes a line.** Rejected: CloudWatch Logs bills each line it takes in, so a flood's cost would grow with its rate again, past the throttle. The lines would also hold callers' addresses. This becomes a "Do not".

## Fitness functions

Both run in the gate and land with this record.

| Check | What it asserts | Where it runs | What it catches |
| --- | --- | --- | --- |
| The API's stage has a throttle | Read as YAML, `serverless.yml` extends `HttpApiStage` with `DefaultRouteSettings` whose `ThrottlingRateLimit` is above 0 and at most 50, and whose `ThrottlingBurstLimit` is a whole number above 0 and at most 100. No route's own settings go above them, and the file declares no HTTP API or stage of its own. | Gate (static) | A throttle dropped, set above this record's values or to zero, or a route or second API that escapes it. |
| A throttled page says it is not connected and recovers | The browser tier answers the page's poll with API Gateway's 429 and body. The page shows "Not connected. Trying again." within one poll and keeps its list, and the note goes with the first poll that passes. A rules save answered the same way says it did not go through. | Gate (browser) | A change that stops polling after a 429, or shows a 429 as something other than a failed request. |

## Consequences

**Easier**

- The cap bounds what a flood costs, where Lambda's concurrency did before, and the requests over the cap cost nothing.
- Nothing new runs or costs money while idle.
- A new limit is a change to two numbers, with its arithmetic in its pull request.

**Harder, and accepted**

- The limit is shared. A flood from one caller shuts out every account while it lasts, as the concurrency limit did before, but at a fraction of the cost.
- An agent over the limit never reads a code or a retry class. Its MCP client reports an HTTP error, and what it does next is up to the client.
- Nothing alerts on a flood that costs little. The owner hears of it from the bill, from someone who could not connect, or by reading the API's metrics.
- AWS applies a throttle on a best-effort basis, so a burst may pass a little over the limit.
- The setting extends a resource the framework makes. If a framework upgrade renamed the stage, the deploy would fail, because the framework refuses to extend a resource it did not make. The static check reads the file, so it cannot see this.
- On an account that still allows only 10 concurrent executions, a flood can reach that limit first. At 50 requests a second, each run of more than 200 milliseconds holds one of the 10. Lambda then throttles the function, and the function-failures alarm fires. The README's setup says to ask AWS to raise the limit.
