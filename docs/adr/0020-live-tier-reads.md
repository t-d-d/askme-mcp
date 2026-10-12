# ADR 20: The live tier only reads, and the service may write to answer it

Decided on 12 October 2026: the live tier sends the page's API reads only, and the service may write what it writes to answer them. Today that is each poll's rate counter, and, when the account holds an ask not yet sorted with the rules in force, the request to sort it again. Any other write that a read causes needs a new decision first. This replaces the words "It writes nothing to askme's store" in the lead and in point 5 of [ADR 16](0016-live-sign-in.md), and the rule in the constraint file that the live tier "writes nothing to askme's store". The rest of ADR 16 stands.

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

- Edits [`docs/constraints/test-tiers.md`](../constraints/test-tiers.md): the live tier makes no write of its own to askme's store and sends the page's API reads only. The service may write a rate counter to answer them, and may ask again for an ask to be sorted. No other write may follow from them. Two new "Do not" entries: no check stops before the page polls or answers its polls itself, and the service makes no exception to a limit for the test account.

## Context

- **The live check's signed-in page writes, through the service.** The check of [ADR 16](0016-live-sign-in.md) signs in and waits for the page to load its list. The page loads it by polling `GET /api/asks`. Since [ADR 18](0018-rate-counter.md), the service counts every poll against the account's limit, as an item under `POLL#<window>`, before it answers. So every run after a deploy writes counter items for the test account.
- **The rule came before the counter.** ADR 16 says the live tier writes nothing to askme's store, and the constraint file says the same. ADR 18 came later and did not mention the live tier. Issue #73 records the gap, found while fixing the live sign-in in #65.
- **A poll can do more than count.** When the account holds an ask that is not sorted with the rules in force a while after it was handed to the sort function, a poll asks for it to be sorted again (PRD, "Back end"). That adds one to the account's `SORT#<window>` counter, and the sort function stores the new sort when it comes. The live tier posts no ask, but anyone can sign in as the test account and connect an agent to it (ADR 16), so such an ask can be there.
- **The poll is the point of the check.** Two of the three risks ADR 16 checks for show only when a signed-in call reaches the service: CloudFront passing the session token on, and the service accepting it. The page's first poll is that call.

## Decision

The live tier makes no write of its own to askme's store, and the service may write what it writes to answer the live tier's reads, and nothing more.

1. **What the live tier sends the page's API.** Reads only: `GET` on the page's read routes, the list, the connection and the rules. The MCP check's call with no token, which the service refuses, is not the page's API and stays as it is. It posts, opens, dismisses and replaces no ask, saves no rules, and presses no control that does. Clerk's writes stay as ADR 16 sets them.
2. **What its reads may cause.** Each poll adds one to the account's poll counter, `POLL#<window>` (ADR 18). A poll that finds an ask not sorted with the rules in force may also ask for it to be sorted again: that adds one to `SORT#<window>`, and the sort function stores the sort when it comes. Every counter item expires an hour after its window ends (ADR 18).
3. **Anything else.** Any other write that a read of the page's API comes to cause needs a new decision before the live tier may cause it. ADR 16 already named one: storing a new account's example rules when it first loads. Today the service builds them on each read and stores nothing.
4. **What the check keeps.** The signed-in page's poll stays in the check, with the list check of ADR 16, point 4.

## Alternatives considered

1. **Keep the rule, and stop the check before the page polls.** The run makes no write at all. Rejected: the poll is the only part of the check that shows the token reaching the service and passing. Without it the check proves only that Clerk sends the person back to the page, and two of the three risks of ADR 16 go unchecked. An implementer is likely to reach for this, so it becomes a "Do not" in the constraint file.
2. **Keep the rule, and have the check answer the page's polls itself,** with Playwright's routes, so no poll reaches the service. Rejected for the same reason: the service never sees the token. This is likely too, and shares the "Do not" above.
3. **Leave the counters out for the test account,** in the service. Rejected: it puts a test's needs into the service, and its address is written in the repo for anyone to sign in with (ADR 16), so it would be the one account any stranger could poll without a limit. An implementer is likely to reach for this, so it becomes a "Do not" in the constraint file.
4. **Allow every write the live tier's reads cause, with no list.** It is the simplest rule to state. Rejected: a later change, such as storing a new account's example rules when it first loads, would then pass with nobody deciding it, and ADR 16 asked for that case to be decided.

## Fitness functions

The first runs in the gate and blocks a merge. The second runs in the live tier, after each deploy. Both land with this record. The third is ADR 18's, in the integration tier, and stands.

| Check | What it asserts | What it catches |
| --- | --- | --- |
| The live tier presses only controls that read | Every control that a `*.live.ts` file, or a file one imports, finds by its role is one of Sign in, Sign up, Continue, Rules, Connect agents, All asks and Sign out. | A step added to the check that sends sample asks, saves the rules or dismisses an ask. |
| The signed-in check sends the API only reads | The live check records every request the page sends its own API. It fails unless the page polled at least once and every request is a `GET` on one of the page's read routes. | A write the gate's list cannot see, such as a control found by its text, and a page that writes by itself while the check runs. |
| An idle poll is one read | A poll carrying the current version reads `META` and nothing else, and writes nothing but its counter (ADR 18). | A poll that writes more than its counter. |

## Consequences

**Easier**

- The rule matches what the live check does after each deploy.
- The check keeps the signed-in poll, the one call that proves a person's token passes through CloudFront to the service.
- A write that the live tier sends shows in the gate if it comes from a control the check names, and in the live run if it comes another way.

**Harder, and accepted**

- Each run leaves a few counter items for the test account. Each expires an hour after its window ends, and none holds anything the page shows.
- If someone leaves an ask on the test account that is not sorted with the rules in force, a run asks for it to be sorted again. That spends a call to the model. The account's limit on such requests applies, as it does to any poll.
- The gate's list is read from the source, so a write sent through a control found some other way, or from the keyboard, shows only in the live run, after the merge. So does a listed name that Playwright matches inside a longer one, such as a button found as "Rules" without `exact`, which would match Save rules.
- A new read route the page calls on its first screens fails the live check until it joins the page's read routes in the shared API module.
- The rule now depends on what the service writes to answer a read. A change that adds such a write changes this rule too, and needs a new decision. ADR 18's check sees one only on an idle poll, so the rest is left to judgment.
