# ADR 26: After each deploy, the live tier sends sample asks and dismisses them

Decided on 13 October 2026: the live tier's signed-in check, as the one test account and through the page, presses Send sample asks once, waits until each ask it posted shows as sorted, and dismisses each of them. Those are its only writes of its own. Every other call it sends the page's API stays a read. Issue #337 raised it, and the owner agreed to it. This replaces these parts of [ADR 20](0020-live-tier-reads.md): in the lead, the words "the live tier sends the page's API reads only"; point 1 after its first sentence's list of read routes, where it posts and dismisses no ask and presses no control that does; and both of its first two fitness functions, "The live tier presses only controls that read" and "The signed-in check sends the API only reads". The rest of ADR 20 stands, as ADR 22 left it.

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

- Edits [`docs/constraints/test-tiers.md`](../constraints/test-tiers.md): the live tier's rule now allows one press of Send sample asks and the dismissal of each ask that press posted, and no other write of its own. Three new "Do not" entries: no change to the test account's rules in the live tier, no check on which hashtags or level a sample got, and no second press after a refusal.

## Context

- **Nothing tests the sort against real services.** The sort runs through the SQS trigger, the functions' permissions, the key read from Parameter Store, the OpenRouter key, the model and its provider routing, the write that stores the sort, and the poll that shows it. The gate fakes every one of them. A deploy can break sorting for every account with the gate and the live check both green.
- **The live tier was kept from writing.** ADR 20 lets the live tier send the page's API reads only, so it cannot post an ask, and an ask is the only thing that starts a sort.
- **The page already has a control that posts asks.** Send sample asks posts one ask for each of the three sample areas, through the same path an agent's ask takes to the queue. The test account can press it like any person.

## Decision

The live tier may post sample asks and dismiss them, as the test account, through the page, and makes no other write of its own.

1. **What it presses.** After the check of ADR 16 signs in and reads the list, it opens Connect your agents, as it does already, and presses Send sample asks once.
2. **What it waits for.** Each ask that press posted must show as sorted: its card shows its sort, not "Not sorted yet", and the account's answer no longer counts it in the sorting line. It checks that each was sorted, not which hashtags or level it got, because the model is not deterministic.
3. **The time limit.** A sort that fails once comes back after the queue's six-minute visibility timeout (ADR 22). So the check waits up to eight minutes from the press, then fails, naming the asks still not sorted.
4. **A refusal.** If the service refuses the press, the check fails with the service's own words. That includes "Every sample ask was sent in the last 10 minutes". A press skips any sample sent in the last ten minutes, and each area holds eight, so only about eight runs within ten minutes meet it. That is rare, so the check does not wait it out.
5. **The dismissal.** It opens each card it posted and presses Dismiss, and waits until the page has sent that dismissal. It opens no card by following its link, so it marks none opened.
6. **What follows from these writes.** The service writes what it writes for any sample ask: the ask, its dedupe record, the ask counters, the model call counter, and the sort. A run costs three model calls on the service's key, and three of the test account's 100 asks a day.
7. **Everything else stays as ADR 20 sets it.** Every other call the check sends the page's API is a `GET` on one of the page's read routes, and the poll stays in the check. Any other write needs a new decision.

## Alternatives considered

1. **Keep the live tier to reads, and test the sort by hand after a deploy.** Rejected: a broken sort would reach every account until someone looked, and nothing reminds anyone to look.
2. **Post the ask from a real MCP client.** It covers more, from the agent's side. Rejected: it needs an agent token from Clerk's sign-in and consent screens, driven in CI. The README's manual checklist covers that path.
3. **Save the rules to make the service sort again.** Rejected: a re-sort goes through the same queue, so it tests nothing more, and it would leave the test account's rules changed. An implementer is likely to reach for this, so it becomes a "Do not" in the constraint file.
4. **Check the hashtags and level each sample got.** Rejected: the model is not deterministic, so the check would fail on a good deploy. The eval set judges the sorts. This is likely too, and becomes a "Do not".
5. **Press Send sample asks again after the ten-minute refusal, until the service takes it.** Rejected: it takes about eight runs within ten minutes, which is rare, and the wait would add up to ten minutes to the run. A failure that names the cause tells whoever reads it to rerun the job. This becomes a "Do not".

## Fitness functions

The first runs in the gate and blocks a merge. The second and third run in the live tier, after each deploy. All three land with this record, and the first two replace ADR 20's first two.

| Check | What it asserts | What it catches |
| --- | --- | --- |
| The live tier presses only listed controls | Every control that a `*.live.ts` file, or a file one imports, finds by its role is one of Sign in, Sign up, Continue, Rules, Connect agents, All asks, Send sample asks, Dismiss and Sign out. | A step added to the check that saves the rules, opens an ask's link, or presses Undo. |
| The signed-in check writes only its samples | The live check records every request the page sends its own API. It fails unless the page polled at least once, sent one `POST` to the samples route, and sent each ask that press posted to the dismissed route once, and unless every other request is a `GET` on one of the page's read routes. | A write the gate's list cannot see, a page that writes by itself while the check runs, and a sample left on the account. |
| Sample asks are sorted on the live site | After the press, each ask it posted shows as sorted within eight minutes. | A deploy that breaks any part of the sort: the queue's trigger, a permission, the key, the model's routing, or the write that stores the sort. |

## Consequences

**Easier**

- A deploy that breaks sorting fails the live check. Once #339 lands, that failure also rolls the deploy back.
- The check runs the same path a person's first sample asks take, from the press to the card.

**Harder, and accepted**

- Each run spends three model calls on the service's key, and three of the test account's 100 asks a day. A day of more than about thirty deploys would reach the cap and fail the check.
- Each run takes as long as the sorts take, and up to eight minutes when one fails once.
- About eight runs within ten minutes use up every sample, and the next fails on the samples' dedupe window. Rerunning the job ten minutes later passes it.
- A run that fails between the press and the dismissals leaves its samples on the test account. The next run's press posts new ones beside them, and the old ones stay until someone dismisses them.
- The check now depends on the page's sample button, its card screen and its Dismiss button. A change to any of them changes the live check too.
