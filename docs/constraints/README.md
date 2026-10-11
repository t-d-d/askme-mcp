# Constraints

The rules in force, one file per topic. A decision record in [`docs/adr/`](../adr/README.md) says why a rule exists. The file here says what the rule is, in a form short enough to read before changing the code it covers.

| File | Decision | From |
| --- | --- | --- |
| [agents-write-only.md](agents-write-only.md) | An agent connection can post, replace and resolve asks, and can read nothing about the account. | [ADR 2](../adr/0002-agents-write-only.md) |
| [alerting.md](alerting.md) | Four alarms, scoped to askme, all emailing the owner through one topic: error lines, function failures, server errors, spend. | [ADR 8](../adr/0008-alerting.md) |
| [ask-idempotency.md](ask-idempotency.md) | ask is delivered at least once; an identical ask on the same account within ten minutes returns the first id. | [ADR 3](../adr/0003-idempotency.md) |
| [error-contract.md](error-contract.md) | Every refusal carries one of six codes, each marked retry or do not retry, and is sent as a tool result the model can read. | [ADR 11](../adr/0011-error-contract.md) |
| [hosting.md](hosting.md) | AWS only: a static React page on S3 and CloudFront, the API and MCP server on Lambda, data in DynamoDB. | [ADR 5](../adr/0005-hosting.md) |
| [identity.md](identity.md) | Clerk owns sign-in and is the OAuth server for agents; the service only verifies tokens and takes the account from them. | [ADR 6](../adr/0006-identity.md) |
| [logging.md](logging.md) | Levels mean routing (error = alert, warn = review later, info = as designed); every line names an event; no user content is logged. | [ADR 7](../adr/0007-logging.md) |
| [polling.md](polling.md) | The page polls for changes; the service holds no live connections and runs no always-on compute. | [ADR 1](../adr/0001-polling.md) |
| [repo-and-delivery.md](repo-and-delivery.md) | One repo on GitHub; main is protected and changes arrive by pull request; a green merge to main deploys to the one environment. | [ADR 4](../adr/0004-repo-and-delivery.md), [ADR 15](../adr/0015-conformance-tier.md) |
| [styling.md](styling.md) | Plain CSS from one tokens file, a CSS Module per component, hashtag colour set as three custom properties, no styling library. | [ADR 14](../adr/0014-styling.md) |
| [table-design.md](table-design.md) | One table. The partition key is the account id from the token, the sort key names the item, with no indexes and no scans. | [ADR 13](../adr/0013-table-design.md), [ADR 17](../adr/0017-rate-counter.md) |
| [test-tiers.md](test-tiers.md) | Six tiers kept apart by file suffix; static, unit, integration and browser form an offline, secret-free gate; live runs after deploy, conformance daily. | [ADR 9](../adr/0009-test-pyramid.md), [ADR 15](../adr/0015-conformance-tier.md), [ADR 16](../adr/0016-live-sign-in.md) |
| [types-and-lint.md](types-and-lint.md) | Every TypeScript strictness option is on, lint is type-aware with no warnings, and outside data is parsed by a schema before use. | [ADR 10](../adr/0010-types-and-lint.md) |
| [untrusted-ask-text.md](untrusted-ask-text.md) | Ask text is untrusted data. The model picks from fixed answers, has no tools, and nothing it says is returned to an agent. | [ADR 12](../adr/0012-untrusted-ask-text.md) |

## Format

Every file has the same parts, in this order.

- **Relevance:** when to read the file, and the paths it covers.
- **Decision:** the rule in one line of 160 characters or fewer.
- **Why:** the reason, in a few lines.
- **Rules:** what must hold.
- **Do not:** the tempting alternatives that were rejected, each with its reason.
- **Judgment:** optional. How to decide a case the rules do not cover.
- **History:** the decision records behind the file.
