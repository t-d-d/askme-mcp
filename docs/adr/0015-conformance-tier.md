# ADR 15: Setup held outside the repo is checked by a tier of its own

Decided on 11 October 2026: a sixth test tier, conformance, checks that the setup askme depends on outside the repo still matches what the repo records. It runs every day, outside the gate. It only reads, and may sign in to do so with a read-only credential. This adds to [ADR 9](0009-test-pyramid.md), which set five tiers, and to [ADR 4](0004-repo-and-delivery.md), which allowed CI one stored secret.

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

- Edits [`docs/constraints/test-tiers.md`](../constraints/test-tiers.md): six tiers, not five. The live tier checks the deployed site and nothing else.
- Edits [`docs/constraints/repo-and-delivery.md`](../constraints/repo-and-delivery.md): besides the Serverless Framework access key, CI may hold read-only keys that only the conformance workflow uses.

## Context

- **Some of askme's setup lives outside the repo.** The ruleset that protects main is a GitHub setting. The Clerk dashboard settings and parts of the AWS account are the same. Issue #1 recorded them, but no file in the repo holds them.
- **That setup can drift with no pull request.** Anyone with access can change a setting, and the gate would not notice.
- **Most of it can only be read signed in.** GitHub shows a branch's rules to anyone, but Clerk's settings and the AWS account show nothing without a credential.
- **[ADR 4](0004-repo-and-delivery.md) already needs one such check.** "Main is protected" reads the repo's settings on a schedule. The gate is offline, so it cannot run there. The live tier is for the deployed site, so it does not belong there either. Without a tier of its own, each such check needs a workflow and a script of its own.
- **More checks of this kind will follow**, such as one for the Clerk settings. Each needs a place that says what it may touch.

## Decision

Checks of setup held outside the repo form their own tier, which runs every day.

1. **The tier.** A file named `*.conformance.ts` is a conformance test. The tier has its own Vitest project.
2. **What it checks.** That a setting outside the repo still matches what the project records: a decision record, a constraint file or an issue's closing comment. It does not check the deployed site. That stays the live tier's job.
3. **When it runs.** Every day, from the `conformance` workflow, which the owner can also start by hand. Not in the gate, and not on deploy.
4. **What it may touch.** A service's settings, read only. A check may sign in, with the narrowest read-only credential the service offers: the workflow's own GitHub token, an AWS role that can only read, or a read-only key kept as a repo secret that only the conformance workflow uses. Never the deploy role, and never a credential that can write. A new credential needs no new decision, as long as it keeps to that scope.
5. **The live tier narrows** to the deployed site, signed out and read only, as CLAUDE.md already describes it.

## Alternatives considered

1. **Keep such checks in the live tier.** It needs no new tier. Rejected: the live tier runs after a deploy and checks the site, while a setting can change on a day with no deploy. The tier would also stop saying what its files touch. An implementer is likely to reach for this, so it becomes a "Do not" in the constraint file.
2. **A scheduled workflow that calls the APIs itself, with no test file.** It is less machinery. Rejected: the check would carry no `fitness:` name, sit outside the one test runner, and escape the checks that keep the tiers apart.
3. **Run the checks in the gate.** They would block a merge. Rejected: the gate is offline ([ADR 9](0009-test-pyramid.md)), and no pull request can change the settings these checks read.
4. **Sign in to nothing, and decide each credential on its own.** It keeps CI's secrets to one. Rejected: most of the setup worth checking cannot be read signed out, and a decision per credential would answer the same question each time. What keeps a credential safe is its scope, which the rules fix: read only, and never the deploy role.
5. **Let conformance use the deploy role.** CI can already assume it. Rejected: it has administrator access, and a check that only reads should not hold a credential that can change everything. An implementer is likely to reach for this, so it becomes a "Do not" in the constraint file.

## Fitness functions

All three run in CI and block a merge.

| Check | What it asserts | What it catches |
| --- | --- | --- |
| Tiers stay apart | Each tier, conformance included, matches only its own suffix, and the gate does not run live or conformance. | A conformance check swept into the gate. |
| Conformance runs daily and only reads | The `conformance` workflow runs on a schedule, runs only the conformance tier, has read permissions only, and cannot reach the deploy role. | The daily run being dropped, or given a way to write. |
| No long-lived keys | Only the deploy workflow holds the Serverless key, and only the conformance workflow holds any other secret. | A stored secret spreading to another workflow. |

## Consequences

**Easier**

- A change to GitHub's settings shows within a day, whether or not anyone deploys.
- A new check of outside setup has an obvious place and name.
- The live tier again says exactly what it touches.

**Harder, and accepted**

- There is a sixth tier to know about.
- A failed daily run reaches the owner only as GitHub's email about a failed workflow, not through the alarms of [ADR 8](0008-alerting.md).
- CI can hold more stored secrets, one read-only key for each service checked. Whether a third-party key can only read is checked by hand when it is made, because no test can see its scope. An AWS role lives in the repo's own templates, where a static test can check it.
- A repo secret reaches a workflow run from any pushed branch, before the gate. The workflows' own checks keep a key in the conformance workflow on main, but not on a branch someone pushes.
- The GitHub check reads signed out, which shares a rate limit for each address. It can move to the workflow's own token if that starts to fail.
- GitHub pauses the scheduled workflows of a public repo after 60 days with no activity. Once the demo goes quiet, the daily check stops without warning.
