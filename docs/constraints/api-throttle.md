# API throttle
Relevance: The API's request rate, the API Gateway stage, a new route, or how often the page or an agent calls: the deployment definition, web/src/poll.ts, the README's demo notice
Decision: API Gateway throttles the API at 50 requests a second, bursts of 100, shared by all routes and accounts. A request over it gets a 429 and starts no function.

Why: Every other limit counts one account's requests inside the
function, and a request that reaches the function costs money, signed
in or not. A throttle at API Gateway stops a flood before it is billed.

## Rules

- The stage's default route settings set a rate of 50 a second and a
  burst of 100, in serverless.yml, as an extension of the framework's
  stage, HttpApiStage.
- The throttle covers every route, the MCP endpoint and the page's API
  alike, and they all share its one allowance. No route sets a throttle
  of its own, and no HTTP API or stage is declared apart from it.
- The extension replaces the framework's default route settings whole,
  so it repeats DetailedMetricsEnabled: false.
- A request over the limit gets API Gateway's own 429 and body, and
  reaches no askme code. It carries no refusal code and is no tool
  result (error-contract.md).
- The page treats that 429 as a failed request. A read says "Not
  connected. Trying again." and tries again, and a save says it did
  not go through.
- No alarm reads it. The spend alarm is the alert, and the API's Count
  and 4xx metrics show a flood.
- The arithmetic counts the allowance once. A flood held at the cap
  reaches the function at about 50 a second, about $5 a day in request
  charges, and up to about $9 where the cap passes more (#398).
- A pull request that adds a route, or makes the page or an agent call
  more often, redoes the arithmetic for real use, counting every route
  together against the one rate. One that raises a value also redoes what a
  flood at the rate costs a day.

## Do not

- Give a route, such as the poll's, a throttle of its own: it may get
  an allowance apart from the shared one, which would raise what a
  flood costs past the arithmetic. #398 did not measure it.
- Limit the total rate in the handler or the table: a request the
  function counts has already started the function, which is the cost.
- Cap the function with reserved concurrency: API Gateway still bills
  each request it passes on, and every throttled run trips the
  function-failures alarm.
- Add an alarm on the API's 4xx count: it counts every 401 too, and the
  owner can only wait out a flood held at the cap (alerting.md).
- Turn on the stage's access logs to see throttled requests: CloudWatch
  bills each line, so a flood's cost would grow past the throttle again.

Judgment: Only the deployed API shows that AWS applies the throttle,
that the routes still share it, and that it counts a throttled request
in the API's 4xx metric. #398 measured the sharing by sending two
routes 40 a second each. Both got 429s once the burst ran out. Whether
50 a second still covers real use on every route together is a
judgement to make as accounts grow.

History: [ADR 31](../adr/0031-api-throttle.md), [ADR 34](../adr/0034-one-throttle-allowance.md)
