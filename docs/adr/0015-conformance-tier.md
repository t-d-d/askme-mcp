# ADR 15: Setup held outside the repo is checked by a tier of its own

Decided on 11 October 2026: a sixth test tier, conformance, checks that the setup askme depends on outside the repo still matches what the repo records. It runs every day, outside the gate. It only reads, and may sign in to do so. This adds to [ADR 9](0009-test-pyramid.md), which set five tiers, and to [ADR 4](0004-repo-and-delivery.md), which allowed CI one stored secret.

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

- Edits [`docs/constraints/test-tiers.md`](../constraints/test-tiers.md): six tiers, not five. The live tier checks the deployed site and nothing else.
- Edits [`docs/constraints/repo-and-delivery.md`](../constraints/repo-and-delivery.md): besides the Serverless Framework access key, CI may hold keys for conformance checks, kept as secrets of a GitHub environment named `conformance`. That environment labels a token. Nothing deploys to it, so there is still one environment.

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
4. **What it may touch.** A service's settings, read only. A check may sign in, with the narrowest credential the service offers: one that only reads where the service has such a thing, and otherwise its narrowest key. The check itself only reads. A new credential needs no new decision, as long as it keeps to these rules.
5. **How a check signs in.** A job that uses a stored key or an AWS token runs in a GitHub environment named `conformance`, which only main may use. The workflow's own GitHub token, which only reads, needs no environment.
   - A key is a secret of that environment, so a run from another branch cannot read it.
   - For AWS, the job asks for an OIDC token. The token's subject names the environment, which the deploy role does not trust, because its trust names main with no environment. A role that can only read trusts that subject and nothing else.
   - The job never uses the deploy role.
6. **The live tier narrows** to the deployed site, signed out and read only, as CLAUDE.md already describes it.

## Alternatives considered

1. **Keep such checks in the live tier.** It needs no new tier. Rejected: the live tier runs after a deploy and checks the site, while a setting can change on a day with no deploy. The tier would also stop saying what its files touch. An implementer is likely to reach for this, so it becomes a "Do not" in the constraint file.
2. **A scheduled workflow that calls the APIs itself, with no test file.** It is less machinery. Rejected: the check would carry no `fitness:` name, sit outside the one test runner, and escape the checks that keep the tiers apart.
3. **Run the checks in the gate.** They would block a merge. Rejected: the gate is offline ([ADR 9](0009-test-pyramid.md)), and no pull request can change the settings these checks read.
4. **Sign in to nothing, and decide each credential on its own.** It keeps CI's secrets to one. Rejected: most of the setup worth checking cannot be read signed out, and a decision per credential would answer the same question each time. What keeps a credential safe is its scope, which the rules fix: read only, and never the deploy role.
5. **Let conformance use the deploy role.** CI can already assume it. Rejected: it has administrator access, and a check that only reads should not hold a credential that can change everything. An implementer is likely to reach for this, so it becomes a "Do not" in the constraint file.
6. **Tell the workflows apart by name in the deploy role's trust.** GitHub can put the workflow's file in the token's subject, so the deploy role could trust only `deploy.yml`. Rejected: it changes how GitHub signs every token for the repo, so the deploy role's trust has to change in the same step, and it keeps no key away from a run on another branch. The environment does both. It rests on one setting, that only main may use it, and a conformance check reads that setting every day.
7. **Allow only keys that cannot write.** It is the safest rule. Rejected: some services, such as Clerk, appear to offer no read-only key, so their settings could never be checked.

## Fitness functions

All but the last run in CI and block a merge. The last is itself in the conformance tier. When the first AWS check lands, a static test of its read role's trust and permissions lands with it.

| Check | What it asserts | What it catches |
| --- | --- | --- |
| Tiers stay apart | Each tier, conformance included, matches only its own suffix, and the gate does not run live or conformance. | A conformance check swept into the gate. |
| Conformance runs daily and only reads | The `conformance` workflow runs on a schedule and only the conformance tier. Its permissions only read, except a token for a job in the `conformance` environment. | The daily run being dropped, or given a way to write. |
| No long-lived keys | Only the deploy job holds the Serverless key, and only the conformance workflow holds any other secret. | A stored secret spreading to another workflow. |
| Only main can assume the deploy role | The deploy role trusts the subject for main with no environment, so a conformance token is refused. Only the deploy job, and conformance jobs in their environment, ask for a token, and only they name a secret in the conformance workflow. | A conformance check reaching the administrator role, or a key outside its environment. |
| Only main may use the conformance environment | Once the environment exists, its branch rule lets main use it and nothing else. This one is a conformance check, run daily. | The rule being removed, so a run from another branch reads the keys. |

## Consequences

**Easier**

- A change to GitHub's settings shows within a day, whether or not anyone deploys.
- A new check of outside setup has an obvious place and name.
- The live tier again says exactly what it touches.

**Harder, and accepted**

- There is a sixth tier to know about.
- A failed daily run reaches the owner only as GitHub's email about a failed workflow, not through the alarms of [ADR 8](0008-alerting.md).
- CI can hold more stored secrets, one key for each service checked. How narrow a third-party key is gets checked by hand when it is made, because no test can see its scope. An AWS role lives in the repo's own templates, where a static test can check it.
- A service with no read-only key, such as Clerk appears to be, means CI holds a key that could write. The check only reads, and the key stays in the `conformance` environment on main.
- The `conformance` environment, and its rule that only main may use it, are settings in GitHub. The owner makes them when the first check needs a credential, and a conformance check reads the rule every day after that.
- The GitHub check reads signed out, which shares a rate limit for each address. It can move to the workflow's own token if that starts to fail.
- GitHub pauses the scheduled workflows of a public repo after 60 days with no activity. Once the demo goes quiet, the daily check stops without warning.
