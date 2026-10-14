# Decision records

Each technical decision that is hard to reverse is recorded here, one file per decision, numbered in order. The product decisions are in the [PRD](../../PRD.md).

| ADR | Decision | Constraint file |
| --- | --- | --- |
| [1](0001-polling.md) | The page polls, and nothing stays connected | [polling.md](../constraints/polling.md) |
| [2](0002-agents-write-only.md) | Agents can write asks and read nothing | [agents-write-only.md](../constraints/agents-write-only.md) |
| [3](0003-idempotency.md) | An ask is delivered at least once and deduplicated by content | [ask-idempotency.md](../constraints/ask-idempotency.md) |
| [4](0004-repo-and-delivery.md) | One repo, a protected main, and one environment | [repo-and-delivery.md](../constraints/repo-and-delivery.md) |
| [5](0005-hosting.md) | AWS, with a static page, Lambda and DynamoDB | [hosting.md](../constraints/hosting.md) |
| [6](0006-identity.md) | Clerk handles sign-in and agent authorisation | [identity.md](../constraints/identity.md) |
| [7](0007-logging.md) | A log level says what happens next, and logs hold no user content | [logging.md](../constraints/logging.md) |
| [8](0008-alerting.md) | One net for errors, a few alarms, and alerts by email | [alerting.md](../constraints/alerting.md) |
| [9](0009-test-pyramid.md) | Five test tiers, four of them in an offline gate | [test-tiers.md](../constraints/test-tiers.md) |
| [10](0010-types-and-lint.md) | The compiler and the linter are as strict as they go | [types-and-lint.md](../constraints/types-and-lint.md) |
| [11](0011-error-contract.md) | A refusal tells the agent what went wrong and whether to retry | [error-contract.md](../constraints/error-contract.md) |
| [12](0012-untrusted-ask-text.md) | Ask text is data to the sorting model, never instructions | [untrusted-ask-text.md](../constraints/untrusted-ask-text.md) |
| [13](0013-table-design.md) | One table, with everything keyed by account | [table-design.md](../constraints/table-design.md) |
| [14](0014-styling.md) | Styles are plain CSS built from one set of tokens | [styling.md](../constraints/styling.md) |
| [15](0015-conformance-tier.md) | Setup held outside the repo is checked by a tier of its own | [test-tiers.md](../constraints/test-tiers.md), [repo-and-delivery.md](../constraints/repo-and-delivery.md) |
| [16](0016-live-sign-in.md) | After each deploy, one test account signs in on the live page | [test-tiers.md](../constraints/test-tiers.md) |
| [17](0017-spend-reads-the-bill.md) | The spend alarm reads the account's bill | [alerting.md](../constraints/alerting.md) |
| [18](0018-rate-counter.md) | A rate counter is written without raising the version | [table-design.md](../constraints/table-design.md) |
| [19](0019-unknown-tool-name.md) | A call to a tool askme does not have gets the MCP spec's protocol error | [error-contract.md](../constraints/error-contract.md) |
| [20](0020-live-tier-reads.md) | The live tier only reads, and the service may write to answer it | [test-tiers.md](../constraints/test-tiers.md) |
| [21](0021-model-call-cap.md) | Each account has a daily cap on model calls | [model-call-cap.md](../constraints/model-call-cap.md), [table-design.md](../constraints/table-design.md) |
| [22](0022-sort-queue.md) | Sort jobs go through a FIFO queue, and the poll only reads | [sort-queue.md](../constraints/sort-queue.md), [hosting.md](../constraints/hosting.md), [polling.md](../constraints/polling.md), [table-design.md](../constraints/table-design.md), [model-call-cap.md](../constraints/model-call-cap.md), [test-tiers.md](../constraints/test-tiers.md) |
| [23](0023-agent-closed-asks-are-not-matched.md) | An identical ask after the agent closed the first is posted as new | [ask-idempotency.md](../constraints/ask-idempotency.md) |
| [24](0024-failure-before-a-tool-runs.md) | An MCP call that fails before a tool runs gets no tool result | [error-contract.md](../constraints/error-contract.md) |
| [25](0025-roll-back-to-live-ok.md) | A failed live check redeploys the last build that passed it | [repo-and-delivery.md](../constraints/repo-and-delivery.md) |
| [26](0026-live-tier-sends-samples.md) | After each deploy, the live tier sends sample asks and dismisses them | [test-tiers.md](../constraints/test-tiers.md) |
| [27](0027-expired-asks-are-not-matched.md) | An identical ask after the first has expired is posted as new | [ask-idempotency.md](../constraints/ask-idempotency.md) |
| [28](0028-page-csp.md) | The page's CSP names every outside origin it uses | [content-security-policy.md](../constraints/content-security-policy.md) |
| [29](0029-api-throttle.md) | API Gateway caps the API's total request rate | [api-throttle.md](../constraints/api-throttle.md), [error-contract.md](../constraints/error-contract.md) |

## How a decision is recorded

- A new decision is a new file with the next number. It arrives by pull request, like any other change.
- Each record has the same sections: constraint-set delta, context, decision, alternatives considered, fitness functions and consequences.
- A record is not edited once merged, except to fix an error. A decision that changes gets a new record, which says which one it replaces.
- The rules a decision puts in force live in [`docs/constraints/`](../constraints/README.md). The pull request that adds a record also adds or changes the constraint file.
