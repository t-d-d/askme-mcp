# ADR 23: The live tier may read the repo's own files, to compare them with what the deploy produced

Decided on 13 October 2026: a live-tier test may read the repo's own files from the checkout it runs in, and write none, to check them against what the deploy just produced. The first is the README's check that it gives the page's address and the MCP endpoint ([#316](https://github.com/t-d-d/askme-mcp/issues/316)). This adds to the live tier of [ADR 9](0009-test-pyramid.md), which touched the live environment and nothing else. The rest of ADR 9, and ADRs [15](0015-conformance-tier.md), [16](0016-live-sign-in.md) and [20](0020-live-tier-reads.md), stand.

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

- Edits [`docs/constraints/test-tiers.md`](../constraints/test-tiers.md): the live tier may read the repo's own files, to compare them with what the deploy produced, and writes no file. A new "Do not" entry: nothing writes a value the deploy produced back into the repo. The `Judgment:` line says how to tell a value the deploy produced from setup held outside the repo.

## Context

- **The README gives the live addresses.** Since #316 the README gives the page's address and the MCP endpoint, so a reader can open the page or connect an agent at once. Before, it sent the reader to a deploy run's summary, and GitHub has no stable link to the newest one.
- **The addresses can change.** The deploy makes them, as outputs of the stack. They stay the same from one deploy to the next, but a replaced stack, or a new deployment of the repo, gets new ones. The README would then point at nothing.
- **Only the live job has both.** The deploy job passes the addresses to the live job as `ASKME_URL` and `ASKME_MCP_URL`. The gate runs before the deploy and has neither. The conformance tier runs every day, and reading the stack's outputs there would need an AWS role it does not have.
- **The rules did not allow it.** ADR 9 gives the live tier the live environment to touch, and the static tier the repo's files. The tier table in CLAUDE.md says the live tier may touch "the deployed site, reading only". The constraint file gives the conformance tier the job of comparing setup held outside the repo with what the repo records, and says not to put such a check in the live tier.

## Decision

A live-tier test may read the repo's own files, and write none, to check them against what the deploy produced.

1. **What it reads.** Files in the checkout the live job runs from, which is the commit just deployed. It reads them with Node's own file functions, and imports none that write.
2. **What it compares.** Only values the deploy produced, which reach the live tier through `test/live.ts`. Today those are the page's address and the MCP endpoint, which the README must give.
3. **When they differ.** The check fails. The README is fixed by pull request, like any other change. Nothing writes the new value back.
4. **What stays.** Everything else the live tier does is as ADRs 9, 16 and 20 set it. Settings made by hand outside the repo, such as GitHub's or Clerk's, stay with the conformance tier.

## Alternatives considered

1. **No check.** The README gives the addresses, and nothing compares them with the deploy. Rejected: the addresses are the first thing a reader of the README uses. A replaced stack would leave them pointing at nothing until a reader noticed.
2. **A step in the deploy job** that fails when the README lacks the addresses it just printed. It needs no new rule. Rejected: the check would sit in a workflow, outside the test tiers, where their file names and rules do not reach it. It would also turn the deploy job red, which reads as a failed deploy.
3. **The conformance tier**, reading the stack's outputs every day. Rejected: it needs an AWS role that can read the stack, in the conformance environment, for one comparison. It also reports a day late.
4. **Write the addresses into the README from the deploy job.** Rejected: main takes changes only by pull request, and a deploy that pushes to main needs a token that can get past the ruleset. An implementer is likely to reach for this, so it becomes a "Do not" in the constraint file.

## Fitness functions

The check runs in the gate and blocks a merge. It lands with this record.

| Check | What it asserts | What it catches |
| --- | --- | --- |
| The live tier writes no file | A `*.live.ts` file, or a file one imports, takes from `node:fs` or `node:fs/promises` only functions that read: `existsSync`, `readFile`, `readFileSync`, `readdir`, `readdirSync`, `stat` and `statSync`. It takes neither module whole, by any route. | A live check that edits its checkout, such as one that writes the deploy's addresses into the README to make itself pass. |

## Consequences

**Easier**

- The README gives addresses a reader can use at once. A deploy that changes one fails the live check until the README gives the new one.
- Another fact that only the deploy knows, and the repo records, can be checked the same way, in the tier that has it.

**Harder, and accepted**

- A red live check no longer always means the deployed site is broken. It can mean the README is out of date.
- The first deploy of a new deployment always fails its live check, because the addresses do not exist until that deploy ends. Step 7 of [docs/bootstrap.md](../bootstrap.md) says so.
- The check runs after the merge. A pull request that takes an address out of the README passes the gate, and fails only after the next deploy.
- The gate's check reads what the live tier imports from Node's file modules. A file written another way, such as by a child process or a Playwright option that saves a file, is not seen.
