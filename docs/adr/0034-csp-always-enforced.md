# ADR 34: The page's CSP is always sent enforcing

Decided on 14 October 2026: the page's CSP goes out only as `Content-Security-Policy`. A narrower policy is not tried first as `Content-Security-Policy-Report-Only`, alone or beside the enforcing header. This replaces the last sentence of point 6 of [ADR 28](0028-page-csp.md). The owner chose it under #407, where the constraint file allowed a report-only trial that its checks refused.

Parent PRD: [PRD](../../PRD.md). Amends [ADR 28](0028-page-csp.md).

## Constraint-set delta

Edits [`docs/constraints/content-security-policy.md`](../constraints/content-security-policy.md): the rule that the policy is sent as `Content-Security-Policy` loses its allowance for a report-only trial, and says what happens instead. A new "Do not" forbids a report-only header to try a narrower policy. The "Do not" against a meta tag no longer gives report-only as a reason.

## Context

- **The constraint and its checks disagreed.** The constraint file said a new or narrower policy may go out first as report-only, until a deploy had passed the live check with it. The static check that the page's CSP is enforced fails on a report-only policy. `pageCsp()` in `test/page-csp.ts` fails every static CSP check when the page is sent two CSP headers. So a pull request that used the allowance had to change a check first.
- **The first policy needed report-only, and a later one does not.** Report-only let the first deploys under #391 find what Clerk Protect needs without breaking sign-in, when the page had no policy to fall back on. The page now has an enforced policy. A report-only trial in its place would leave the page with no enforced policy while it runs.
- **A failed live check already rolls the deploy back.** Under [ADR 25](0025-roll-back-to-live-ok.md), the same run redeploys the last build that passed the live check. A narrowing that refuses something Clerk needs fails the live check, and the page goes back to the wider policy in that run. This happened when Clerk Protect's probe ports failed a deploy (ADR 32).
- **Narrowing is rare.** Adding an origin widens the policy, and a wider policy refuses nothing that worked before. Only removing a source, or adding a directive for a kind of load that `default-src` does not cover, such as `form-action`, can break the page. Neither is planned.

## Decision

The page's CSP goes out as `Content-Security-Policy` every time, with no report-only header in its place or beside it.

1. **No report-only trial.** A pull request that narrows the policy sends the narrower policy enforcing. Before the merge, the browser tier tests the page's own code against it. After the deploy, the live check tests Clerk's scripts against it.
2. **A failed live check rolls back.** If the live check hears a violation, the run redeploys the last build that passed it, as ADR 25 says, and the owner reverts the pull request.
3. **The checks stay as they are.** The static checks already hold the page to one CSP header, sent enforcing.
4. The rest of ADR 28 stands.

## Alternatives considered

1. **Allow a report-only header beside the enforcing one.** The wider policy stays enforced while the narrower one reports, and the live check hears both. Rejected: it changes `pageCsp()`, every static CSP check, and the browser tier's page server and its check, for a narrowing nobody has planned. It also shows only what one live run sees. Clerk Protect varies from run to run (ADR 32), so a report-only pass does not prove the narrower policy safe. Someone about to narrow the policy is likely to reach for this, so it becomes a "Do not".
2. **Keep the allowance as ADR 28 wrote it, with report-only in place of the enforcing header.** It needs one header, as now. Rejected: while the trial runs nothing is enforced, and the check that the policy is enforced would have to be turned off for it.
3. **Leave the constraint and the checks as they were.** Rejected: a rule the gate refuses misleads the next person who reads it.

## Fitness functions

| Check | What it asserts | Where it runs | What it catches |
| --- | --- | --- | --- |
| The page's CSP is enforced | The page's policy sends the CSP as `Content-Security-Policy`, not report-only. | Gate (static) | A policy sent report-only, which stops nothing. |
| The page's CSP names only Clerk's origins | As in ADR 30 and ADR 32. The page is sent one CSP header, so a report-only header beside the enforcing one fails each assertion that reads the page's policy. | Gate (static) | A second CSP header, report-only or not. |

Both checks are in the gate already. This record changes neither.

## Consequences

**Easier**

- The constraint file and its checks say the same thing, so a pull request that narrows the policy changes no check.
- The page always has an enforced policy.

**Harder, and accepted**

- A narrowing that refuses something Clerk needs breaks it in real browsers from the deploy until the run's rollback finishes. Sign-in can fail in that time.
- The live check sees one signed-in run. A narrowing that refuses something Clerk loads only on another path, such as a challenge, shows only when a real visitor takes that path, as ADR 28 already accepts.
- Clerk Protect varies from run to run (ADR 32), so a narrowing can pass the live check and still refuse what Clerk Protect loads on a later visit. Nothing rolls that back, and it shows only when sign-in fails for a real visitor or a later deploy's live check fails.
