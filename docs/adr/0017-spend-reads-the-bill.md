# ADR 17: The spend alarm reads the account's bill

Decided on 11 October 2026: the spend alarm reads CloudWatch's billing metric for the whole AWS account, because the account holds askme and nothing else. The other three alarms stay scoped to askme's own resources. This changes rule 2 of [ADR 8](0008-alerting.md) for the spend alarm alone.

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

- Edits [`docs/constraints/alerting.md`](../constraints/alerting.md): the spend alarm may read the account's bill, and the account holds askme alone. Two new "Do not" entries: no budget filtered by a tag in place of the spend alarm, and no other system in askme's account. The `Judgment:` line gains the account's billing alerts, which are switched on by hand.

## Context

- **ADR 8 asked for two things that cannot both hold.** It lists a spend alarm, and it says no alarm reads a metric measured across the whole account. CloudWatch measures cost for a whole account. Its billing metric can be split by service, but never by stack, tag or resource.
- **Issue #1 settled the account.** askme has a standalone AWS account of its own, with no other system in it. The account's bill is askme's bill.
- **Issue #1 settled the region.** askme runs in us-east-1, the only region that holds the billing metric.
- **Issue #6 builds the alarms now.** Its scope check would fail on any spend alarm, so the rule has to say what spend may read.

## Decision

The spend alarm reads the account's bill, and the account holds askme alone.

1. **Spend reads one metric:** `EstimatedCharges` in `AWS/Billing`, in US dollars, with no other dimension. Its threshold is the parameter `/askme/alerts/monthly-spend`.
2. **The other three alarms stay scoped.** Each reads a metric of askme's own, or a metric with a dimension that names one of askme's resources.
3. **The account holds askme alone.** Another system moving in would need a new decision, because its cost would trip askme's spend alarm.
4. **The account's billing alerts stay switched on.** Without them AWS publishes no billing metric, and the alarm never fires. The setting is outside the repo, like the email subscription.

## Alternatives considered

1. **A budget filtered by askme's stack tag.** AWS Budgets can limit a budget to costs that carry a tag, and a budget with no actions is free. It would keep ADR 8's rule as written. Rejected: the owner has to switch the tag on in the Billing console by hand, and the budget misses costs that AWS cannot tag. A budget is not a CloudWatch alarm, so it has no description to say what to do first. In an account that holds askme alone, it measures nearly what the bill does. An implementer is likely to reach for this, so it becomes a "Do not" in the constraint file.
2. **The billing metric split by service.** One alarm each for Lambda, DynamoDB, CloudFront and the rest. Rejected: each is still measured across the whole account, so it scopes nothing, and it is several alarms where ADR 8 wants one.
3. **No spend alarm.** The model key has its own limit, and the daily cap on asks sits in front of it. Rejected: those cap model spend only. Cloud cost from a flood of requests would still run on unseen.

## Fitness functions

This runs in CI and blocks a merge. It replaces ADR 8's "Alarms are scoped" check, and lands with issue #6, which builds the alarms.

| Check | What it asserts | What it catches |
| --- | --- | --- |
| Alarms are scoped | The spend alarm reads `EstimatedCharges` in `AWS/Billing`, in US dollars, and nothing else. Every other alarm reads only metrics of askme's own, or metrics with a dimension that names one of askme's resources. | A second alarm reading an account-wide metric, or the spend alarm reading something other than the bill. |

## Consequences

**Easier**

- One alarm catches every cost the account runs up, including costs AWS cannot tag.
- There is nothing to set up for it beyond what issue #1 did.

**Harder, and accepted**

- Another system cannot share askme's account without a new decision.
- AWS updates the billing metric about every six hours, so a spike shows hours late.
- If the account's billing alerts are switched off, the alarm stays silent, and no check sees it.
