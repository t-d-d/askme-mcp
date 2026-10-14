# Constraints

The rules in force, one file per topic. A decision record in [`docs/adr/`](../adr/README.md) says why a rule exists. The file here says what the rule is, in a form short enough to read before changing the code it covers.

| File | Decision | From |
| --- | --- | --- |
| [agents-write-only.md](agents-write-only.md) | An agent connection can post, replace and resolve asks, and can read nothing about the account. | [ADR 2](../adr/0002-agents-write-only.md) |
| [alerting.md](alerting.md) | Four alarms, scoped to askme, all emailing the owner through one topic: error lines, function failures, server errors, spend. | [ADR 8](../adr/0008-alerting.md), [ADR 17](../adr/0017-spend-reads-the-bill.md) |
| [ask-idempotency.md](ask-idempotency.md) | ask is delivered at least once; an identical ask on one account in ten minutes returns the first id, unless the first expired or the agent closed it. | [ADR 3](../adr/0003-idempotency.md), [ADR 23](../adr/0023-agent-closed-asks-are-not-matched.md), [ADR 27](../adr/0027-expired-asks-are-not-matched.md) |
| [error-contract.md](error-contract.md) | Every refusal from a tool carries one of six codes, each marked retry or do not retry, and is sent as a tool result the model can read. | [ADR 11](../adr/0011-error-contract.md), [ADR 19](../adr/0019-unknown-tool-name.md), [ADR 24](../adr/0024-failure-before-a-tool-runs.md) |
| [hosting.md](hosting.md) | AWS only: a static React page on S3 and CloudFront, the API and MCP server on Lambda, data in DynamoDB, sort jobs in SQS. | [ADR 5](../adr/0005-hosting.md), [ADR 22](../adr/0022-sort-queue.md) |
| [identity.md](identity.md) | Clerk owns sign-in and is the OAuth server for agents; the service only verifies tokens and takes the account from them. | [ADR 6](../adr/0006-identity.md) |
| [logging.md](logging.md) | Levels mean routing (error = alert, warn = review later, info = as designed); every line names an event; no user content is logged. | [ADR 7](../adr/0007-logging.md) |
| [model-call-cap.md](model-call-cap.md) | Every model call is counted against the account's daily cap just before it is sent. A call over the cap is not sent. | [ADR 21](../adr/0021-model-call-cap.md), [ADR 22](../adr/0022-sort-queue.md) |
| [polling.md](polling.md) | The page polls for changes; the service holds no live connections and runs no always-on compute. | [ADR 1](../adr/0001-polling.md), [ADR 22](../adr/0022-sort-queue.md) |
| [repo-and-delivery.md](repo-and-delivery.md) | One repo on GitHub; main is protected and changes arrive by pull request; a green merge to main deploys to the one environment. | [ADR 4](../adr/0004-repo-and-delivery.md), [ADR 15](../adr/0015-conformance-tier.md), [ADR 25](../adr/0025-roll-back-to-live-ok.md) |
| [sort-queue.md](sort-queue.md) | Sort jobs go through one FIFO queue, one group per ask, and read the rules in force when they run. A poll never starts a sort. | [ADR 22](../adr/0022-sort-queue.md) |
| [styling.md](styling.md) | Plain CSS from one tokens file, a CSS Module per component, hashtag colour set as three custom properties, no styling library. | [ADR 14](../adr/0014-styling.md) |
| [table-design.md](table-design.md) | One table. The partition key is the account id from the token, the sort key names the item, with no indexes and no scans. | [ADR 13](../adr/0013-table-design.md), [ADR 18](../adr/0018-rate-counter.md), [ADR 21](../adr/0021-model-call-cap.md), [ADR 22](../adr/0022-sort-queue.md) |
| [test-tiers.md](test-tiers.md) | Six tiers kept apart by file suffix; static, unit, integration and browser form an offline, secret-free gate; live runs after deploy, conformance daily. | [ADR 9](../adr/0009-test-pyramid.md), [ADR 15](../adr/0015-conformance-tier.md), [ADR 16](../adr/0016-live-sign-in.md), [ADR 20](../adr/0020-live-tier-reads.md), [ADR 22](../adr/0022-sort-queue.md), [ADR 26](../adr/0026-live-tier-sends-samples.md) |
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
