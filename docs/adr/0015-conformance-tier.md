# ADR 15: Setup held outside the repo is checked by a tier of its own

Decided on 11 October 2026: a sixth test tier, conformance, checks that the setup askme depends on outside the repo still matches what the repo records. It runs every day, outside the gate. It reads only and signs in to nothing. This adds to [ADR 9](0009-test-pyramid.md), which set five tiers.

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

Edits [`docs/constraints/test-tiers.md`](../constraints/test-tiers.md): six tiers, not five. The live tier checks the deployed site and nothing else.

## Context

- **Some of askme's setup lives outside the repo.** The ruleset that protects main is a GitHub setting. The Clerk dashboard settings and parts of the AWS account are the same. Issue #1 recorded them, but no file in the repo holds them.
- **That setup can drift with no pull request.** Anyone with access can change a setting, and the gate would not notice.
- **[ADR 4](0004-repo-and-delivery.md) already needs one such check.** "Main is protected" reads the repo's settings on a schedule. The gate is offline, so it cannot run there. It first landed in the live tier. But the live tier checks the deployed site after a deploy, and a setting can change on any day.
- **More checks of this kind will follow**, such as one for the Clerk settings. Each needs a place that says what it may touch.

## Decision

Checks of setup held outside the repo form their own tier, which runs every day.

1. **The tier.** A file named `*.conformance.ts` is a conformance test. The tier has its own Vitest project. Its files live in `conformance/`, one file for each outside service.
2. **What it checks.** That a setting outside the repo still matches what the repo records: a decision record, a constraint file or a closing comment. It does not check the deployed site. That stays the live tier's job.
3. **When it runs.** Every day, from the `conformance` workflow, which the owner can also start by hand. Not in the gate, and not on deploy.
4. **What it may touch.** A service's public read API, signed out and read only. The first check that needs a credential, such as one for Clerk's settings, needs its own decision. CI holds one stored secret ([repo-and-delivery.md](../constraints/repo-and-delivery.md)).
5. **The live tier narrows** to the deployed site, signed out and read only, as CLAUDE.md already describes it.

## Alternatives considered

1. **Keep such checks in the live tier.** It needs no new tier. Rejected: the live tier runs after a deploy and checks the site, while a setting can change on a day with no deploy. The tier would also stop saying what its files touch. An implementer is likely to reach for this, so it becomes a "Do not" in the constraint file.
2. **A scheduled workflow that calls the APIs itself, with no test file.** It is less machinery. Rejected: the check would carry no `fitness:` name, sit outside the one test runner, and escape the checks that keep the tiers apart.
3. **Run the checks in the gate.** They would block a merge. Rejected: the gate is offline ([ADR 9](0009-test-pyramid.md)), and no pull request can change the settings these checks read.

## Fitness functions

Both run in CI and block a merge.

| Check | What it asserts | What it catches |
| --- | --- | --- |
| Tiers stay apart | Each tier, conformance included, matches only its own suffix, and the gate does not run live or conformance. | A conformance check swept into the gate. |
| Conformance runs daily, signed out | The `conformance` workflow runs on a schedule, runs only the conformance tier, only reads, and declares no secret. | The daily run being dropped, or given a credential. |

## Consequences

**Easier**

- A change to GitHub's settings shows within a day, whether or not anyone deploys.
- A new check of outside setup has an obvious place and name.
- The live tier again says exactly what it touches.

**Harder, and accepted**

- There is a sixth tier to know about.
- A failed daily run reaches the owner only as GitHub's email about a failed workflow, not through the alarms of [ADR 8](0008-alerting.md).
- Signed-out reads of GitHub's API share a rate limit for each address. A runner on a shared address can be refused for a reason that is not drift.
- A setting that needs a credential to read, such as Clerk's, waits for its own decision.
