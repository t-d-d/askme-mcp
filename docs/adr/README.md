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

## How a decision is recorded

- A new decision is a new file with the next number. It arrives by pull request, like any other change.
- Each record has the same sections: constraint-set delta, context, decision, alternatives considered, fitness functions and consequences.
- A record is not edited once merged, except to fix an error. A decision that changes gets a new record, which says which one it replaces.
- The rules a decision puts in force live in [`docs/constraints/`](../constraints/README.md). The pull request that adds a record also adds or changes the constraint file.
