# ADR 25: A failed live check redeploys the last build that passed it

Decided on 13 October 2026: when the live check fails after a deploy, the same run redeploys the stack and page from the last commit that passed its live check, and runs that commit's live tier against them. A tag, `live-ok`, names that commit, and a passing live check moves it. The run still ends failed, and the owner still reverts the pull request. This replaces point 10 of [ADR 4](0004-repo-and-delivery.md) and the "Rolling back" sentence of [ADR 16](0016-live-sign-in.md)'s consequences. The owner chose this in #327.

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

- Edits [`docs/constraints/repo-and-delivery.md`](../constraints/repo-and-delivery.md): "Roll back by reverting the pull request" becomes a rollback in the same run, followed by the revert. "A green merge to main deploys. Nothing else deploys." gains that rollback as its one exception. Two new "Do not" entries: no rollback of the deploy role's own stack, and no rollback started any way but by a failed live check in the deploy run.

## Context

- **A broken build stays live until the owner acts.** The deploy runs the live tier after it publishes the page. When the check fails, the owner has to see the failed run, open a revert, wait for the gate and merge it, and then wait for that deploy. With nobody watching, that can be hours.
- **The live check is the only check that sees sign-in end to end** ([ADR 16](0016-live-sign-in.md)). A failure there is the strongest sign the service is broken for a person.
- **The deploy role trusts main only.** Its trust names the subject for a job on main, so any job that redeploys has to run in a run on main. The push to main that failed its live check is such a run.
- **The store parses every item with zod.** Code from before a change may not read an item a newer build wrote. That shapes what a rollback can safely put back.

## Decision

The deploy run puts the last good build back by itself, then fails, and the owner reverts the pull request as before.

1. **The tag.** `live-ok` names the last commit whose live check passed. A job that runs only when the live check passes, on the run's first attempt, moves it to the commit the run deployed. A re-run after a rollback would check the build the rollback put back, not the run's own commit, so a re-run never moves the tag. It is the one job in any workflow with `contents: write`.
2. **Moving it cannot fail the run.** If the tag does not move, the run summary says so, and the run still passes. The cost is that a later rollback goes one build further back.
3. **The rollback.** When the live check fails, a job looks for `live-ok`. If it finds it, a rollback job checks out that commit, builds its page, deploys its stack with `serverless deploy` and publishes the page, with the same steps as the deploy. A last job runs that commit's own live tier against what the rollback put back.
4. **Not the deploy role's stack.** The rollback does not apply `infra/github-oidc.cfn.yml`. An older template must not undo a change to the role that runs it.
5. **No tag yet.** As on the first deploy, the job that looks for `live-ok` says in the run summary that there is none, and nothing else runs.
6. **The run still fails.** The live check's failure fails the run whatever the rollback does, so the owner sees it and reverts the pull request.
7. **Where it runs.** In the same run, on the push to main, so the role's trust still holds. Nothing else starts a rollback: no manual trigger and no other workflow.
8. **What is live meanwhile.** Until the revert merges, what is live is behind main. Main's next deploy closes the gap.
9. **Stored items.** A change to a stored item's shape keeps the previous build able to read it, or its pull request says why it cannot. A rollback past such a change can fail on read until the new items expire or are rewritten.

## Alternatives considered

1. **Keep the rule: revert and wait.** It needs no new jobs. Rejected: the outage lasts until the owner notices, which with nobody watching can be hours.
2. **Shift Lambda traffic gradually with CodeDeploy, and roll back on an alarm.** It is AWS's own pattern. Rejected: it adds CodeDeploy resources and a plugin, covers the functions but not the page, and acts only on the four alarms in [alerting.md](../constraints/alerting.md), so a fault that writes no error line goes live anyway.
3. **Redeploy the commit before this one,** with no tag. Rejected: that commit may itself have failed its live check, and a rollback to it puts back another broken build.
4. **A workflow the owner starts by hand to roll back.** Rejected: it waits on the owner like a revert, and a manual trigger is a deploy path the rule forbids. An implementer is likely to add one, so it becomes a "Do not" in the constraint file.
5. **Roll back the deploy role's stack too.** It would put back the exact state of the last good build. Rejected: an older template could take away a permission the current deploy needs, and the role is what runs the rollback. An implementer copying the deploy's steps is likely to keep it, so it becomes a "Do not" in the constraint file.

## Fitness functions

| Check | What it asserts | Where it runs | What it catches |
| --- | --- | --- | --- |
| A failed live check redeploys the last good build | Read as YAML, the deploy workflow moves `live-ok` only in a job that needs the live check to pass and runs on the first attempt, and that job alone writes contents and cannot fail the run. The rollback runs only when the live check failed and `live-ok` names a commit. It checks out that commit, repeats the deploy's steps but the role's stack, then runs the live job's steps against what it put back. Nothing after the live check hides its failure. | CI | A tag moved after a failed check, a rollback after a passing one, a rollback that drifts from the deploy, the role's stack rolled back, or a run that ends green after a rollback. |

The check lands with this record.

## Consequences

**Easier**

- A deploy that fails its live check is replaced within one more deploy's time, with nobody awake.
- The owner's part is the same as before: see the failed run, revert the pull request.
- The rollback's own live check says whether what was put back works.

**Harder, and accepted**

- Until the revert merges, what is live is behind main. Reading main no longer says what is live during that window.
- A rollback can meet items a newer build wrote, which the older code may not parse. Each change to a stored item's shape has to keep the previous build able to read it, or say why it cannot.
- `live-ok` can be more than one build back: a re-run, a tag that did not move, or a commit that lands before a revert all leave it further behind. A rollback then crosses more than one change.
- A rollback deploys an older template, so CloudFormation removes any resource the failed build added, unless that resource is retained. A new queue or table loses what it held.
- A rollback does not touch the deploy role's stack, so a broken change to the role is not undone by it.
- The run takes longer when it fails: one more build, deploy and live tier.
- The tag move uses the workflow's own token. No ruleset covers tags today, so it can move the tag. A ruleset on tags added later would stop it, and the run summary would say the tag did not move.
- The live check's failure and the rollback's both show in one failed run. The summary says which commit was put back.
