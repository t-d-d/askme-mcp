# ADR 33: A deploy that fails once its stack deploy has started rolls back too

Decided on 14 October 2026: the rollback to `live-ok` from [ADR 25](0025-roll-back-to-live-ok.md) also starts when the deploy job fails at or after the step that deploys the stack. A failure before that step starts none. Before it deploys, the rollback waits for the stack to settle, and continues a CloudFormation rollback that failed, once, skipping no resource. This amends points 3 and 7 of ADR 25. The owner chose it in #354.

Parent PRD: [PRD](../../PRD.md). Amends [ADR 25](0025-roll-back-to-live-ok.md).

## Constraint-set delta

Edits [`docs/constraints/repo-and-delivery.md`](../constraints/repo-and-delivery.md): the exception to "Nothing else deploys" and the rollback rule add a deploy that fails once its stack deploy has started. A new rule says the rollback first waits for the stack to settle and continues a failed CloudFormation rollback once. Two new "Do not" entries: no rollback after a failure before the stack deploy, and no CloudFormation rollback that skips resources or is forced.

## Context

- **ADR 25 misses a deploy that fails partway.** Its rollback starts only when the live check fails. If the deploy job fails after `serverless deploy` has started, for example in the step that publishes the page, the live check is skipped, not failed. The new functions can then stay live behind the old page, with nothing checking them, until the owner reverts. The review of the pull request for #339 found this.
- **The job cannot always tell whether the stack changed.** CloudFormation undoes a failed stack update by itself. But the stack deploy step can also fail after CloudFormation has finished the update.
- **A failed stack update can leave the stack stuck.** When CloudFormation cannot undo every change, the stack ends in `UPDATE_ROLLBACK_FAILED`, part new and part old. CloudFormation refuses any update to it, so the rollback's own `serverless deploy` fails. `ContinueUpdateRollback` tries the undo again.
- **CloudFormation acts with the job's own session.** The app's stack has no service role, so CloudFormation uses a temporary session made from the deploy role's credentials, which last an hour at most. The role holds `AdministratorAccess`, so a missing permission does not stop an undo here. A session that ran out, a throttled call or a resource slow to settle can. A retry with a new session fixes those. It does not fix a cause that is still there, such as a resource changed outside CloudFormation or a limit the account has reached.

## Decision

The deploy run rolls back to `live-ok` whenever it may have changed what is live and the live check has not passed.

1. **When it starts.** The rollback starts when the live check fails, as before, or when the deploy job fails at or after its stack deploy step. Just before that step, the deploy job records that it is starting it, for the jobs after it to read. A failure before that step changes nothing a person uses and starts no rollback. Those steps are the install, the Serverless checksum, the build and the deploy role's stack. A cancelled run starts none either.
2. **The stack settles first.** Before it deploys, the rollback job reads the status of the app's stack, `askme-prod`. While an update or an undo is in progress, it waits. If the status is `UPDATE_ROLLBACK_FAILED`, it calls `ContinueUpdateRollback` once, with its own new session, and waits for `UPDATE_ROLLBACK_COMPLETE`.
3. **It skips nothing.** The continue names no resource to skip and does not force the rollback. Skipping marks a resource as rolled back when it is not. AWS warns that a later update can then fail and leave the stack unrecoverable. Whether to skip a resource is the owner's call, after reading why it failed.
4. **A stack still stuck stops the rollback.** If the continue fails, the rollback deploys nothing. The run summary says the stack needs the owner, and gives CloudFormation's reason for each resource that failed.
5. **The summary says why the rollback started:** the live check, or the deploy job.
6. **The rest of ADR 25 stands.** The rollback runs in the same run, on the push to main, and nothing else starts one. It does not touch the deploy role's stack, it runs `live-ok`'s live tier afterwards, and the run still ends failed.

## Alternatives considered

1. **Roll back only after the stack deploy step succeeds.** A rollback would follow only a stack that surely changed. Rejected: the step can fail after CloudFormation has finished, and the job cannot tell. A rollback that turns out not to be needed costs one deploy of a build that passed its live check.
2. **Roll back on any failure of the deploy job.** One condition, the easiest to read. Rejected: a failure before the stack deploy changes nothing live, so the rollback is a wasted deploy. After a failed Serverless checksum it fails the same check. An implementer is likely to write this condition first, so it becomes a "Do not" in the constraint file.
3. **Leave a deploy that fails partway to the owner,** as ADR 25 does. No new steps. Rejected for ADR 25's own reason: with nobody watching, unchecked code stays live for hours.
4. **Run the live check after a deploy that fails partway, and roll back only if it fails.** Rejected: the check would test a mix no pull request asked for, the new functions behind the old page. A pass would leave that mix live until the revert.
5. **Skip the resources that cannot be rolled back, or force the rollback,** so a stuck stack always comes back. Rejected for the reason in point 3. An implementer who wants the rollback to succeed is likely to add `--force-rollback`, so it becomes a "Do not" in the constraint file.

## Fitness functions

| Check | What it asserts | Where it runs | What it catches |
| --- | --- | --- | --- |
| A failed deploy redeploys the last good build | Read as YAML, the deploy workflow looks for `live-ok` when the live check fails, or when the deploy job fails having started its stack deploy, and in no other case. The deploy job records that start in the step just before its stack deploy. | Gate (static) | A rollback after a failure that changed nothing, or none after a deploy that failed partway. |
| The rollback deploys over a settled stack | Read as YAML, before its stack deploy the rollback job reads the stack's status, waits while it is in progress, and continues a failed rollback. No workflow step skips resources or forces a CloudFormation rollback. | Gate (static) | A deploy over a stuck stack, or a continue that skips resources. |

The first check replaces the part of ADR 25's "A failed live check redeploys the last good build" that says the rollback runs only when the live check failed. The rest of that check stands. Both checks land with #402, which changes the workflow.

## Consequences

**Easier**

- A deploy that fails partway is replaced by the last good build with nobody awake, as one that fails its live check is.
- A stack left stuck by a cause that has passed, such as a session that ran out, comes back without the owner.

**Harder, and accepted**

- A failed stack update that CloudFormation already undid still costs a rollback: one more build, deploy and live tier.
- A stack the continue cannot bring back stays stuck. The next merge's deploy fails on it, which starts the rollback and tries the continue once more. This repeats until the owner fixes the stack by hand.
- A runner lost during the deploy job may pass no outputs on. Then no rollback starts, and the owner reverts as before ADR 25.
- The rollback job's session lasts an hour at most. A wait for the stack that runs longer fails the rollback.
