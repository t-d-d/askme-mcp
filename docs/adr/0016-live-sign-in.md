# ADR 16: After each deploy, one test account signs in on the live page

Decided on 11 October 2026: after each deploy, the live tier signs in on the deployed page as one fixed test account, through Clerk's own screens, and checks that the signed-in page loads the account's list. It uses the test mode of Clerk's development instance, so it needs no stored secret and no inbox. It writes nothing to askme's store. This replaces rule 8 of [ADR 9](0009-test-pyramid.md) and point 6 of [ADR 15](0015-conformance-tier.md), which kept the live tier signed out.

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

- Edits [`docs/constraints/test-tiers.md`](../constraints/test-tiers.md): the live tier may sign in, as the one test account and no other, with no stored secret. It still writes nothing to askme's store. Two new "Do not" entries: no account made by a test, and no Clerk secret key in the live tier.

## Context

- **Part of the gap ADR 9 named is now in the way.** ADR 9 said that nothing automated proves a signed-in path from a real agent to a card, and called it the largest gap. The page's own sign-in is part of that path. Issue #5 put the page's sign-in, its API behind CloudFront and the check of session tokens live at once. Two of its risks only show signed in: Clerk's session tokens passing the service's check, and Clerk sending a person back to the page after signing in. The third, CloudFront passing the `Authorization` header on, shows signed out only in part: a made-up token refused as invalid, not as missing, proves the header arrived, but not that a real one passes.
- **ADR 9 weighed a different option.** It rejected end-to-end tests as the main safety net, in place of the gate: with one environment they can only run after a merge, they need secrets, and they are slow. That still holds. One signed-in check after each deploy, beside the gate, was never weighed. The rule that the live tier signs in to nothing came with that decision, without a case of its own.
- **Clerk's development instance has a test mode, on by default.** An address with the `+clerk_test` subaddress is verified with the code 424242, and Clerk sends it no email. A sign-in needs no inbox and no key.
- **A real agent's connection is a different matter.** The agent's own app, such as Claude, runs the OAuth sign-in, and a person approves Clerk's consent screen. No test can do that, so it stays a hand check ([ADR 6](0006-identity.md)).
- **ADR 15 already lets CI sign in,** for conformance checks. That tier reads settings every day and does not check the site, so a check of the deployed page belongs in the live tier.

## Decision

One fixed test account signs in on the live page after each deploy, and the check passes only when the signed-in page loads its list.

1. **The account.** There is one, made by the owner in Clerk's dashboard, with an address that carries `+clerk_test`. No test makes, deletes or signs up an account. It is one of the instance's 100.
2. **Its address.** The repo variable `LIVE_TEST_EMAIL`. It is not a secret: in test mode the address and the public code are enough to sign in, so the account holds nothing that matters. Keeping it out of the repo's files keeps it off a public page. GitHub prints a variable's value in a run's log, and a public repo's logs are public, so the live job masks the address before any step that uses it.
3. **How it signs in.** As a person does. It presses Sign in on the live page, gives the address and the code on Clerk's own screens, and lands back on the page. If Clerk's screen offers to make an account for the address, the check fails there and goes no further. That covers the trip to Clerk and back, which a helper that signs in from inside the page would skip.
4. **What it checks.** The page leaves the signed-out screen and shows one of its signed-in screens: the list, the new-account card or All clear, and not "Not connected. Trying again." Connect your agents then shows the MCP address the deploy published. Any of the three screens passes, so asks left in the account do not fail the check.
5. **What it touches.** The live site, signed in as the test account, read only. It posts no ask and changes no rule. Clerk records the sign-in, which is the one write, and it is Clerk's.
6. **What it holds.** No stored secret. If Clerk's bot protection ever blocks the automated sign-in, getting past it takes a testing token, and that needs the instance's secret key. The key can change anything in the instance, so using it here is a new decision.
7. **Where it runs.** In the deploy workflow's live job, after the deploy, with the rest of the tier. A failure fails the run. As with every live check, the merge has already happened.
8. **Agents.** A real agent connecting stays a hand check, with the checklist in [ADR 6](0006-identity.md).

## Alternatives considered

1. **Keep the live tier signed out,** as ADR 9 set it. Rejected: the risks that matter most now sit on the signed-in path, and a hand check depends on someone running it after every deploy.
2. **Sign in with `@clerk/testing`'s server-side helper,** which creates a sign-in token through Clerk's Backend API and skips verification. It is the least code, and Clerk's docs lead with it. Rejected: it needs the instance's secret key, which can create and delete users and change every setting. An implementer is likely to reach for this, so it becomes a "Do not" in the constraint file.
3. **Sign in from inside the page,** with Clerk's client-side helper and an email code, skipping Clerk's screens. It breaks less often when Clerk changes its screens. Rejected as the first choice: it skips the trip to Clerk and back, one of the three things the check is for. If Clerk's screens prove too brittle, this is the fallback. It needs a new decision, because the constraint file says the sign-in goes through Clerk's own screens, and because `@clerk/testing`'s helpers may need a testing token, which needs the secret key.
4. **Make a fresh account on each run.** It would prove sign-up as well. Rejected: the instance holds 100 accounts, and a run on every deploy would use them up. Deleting them again from a test needs the secret key. An implementer is likely to reach for this, so it becomes a "Do not" in the constraint file.
5. **A second environment, with its own Clerk instance, for signed-in tests.** Rejected in [ADR 4](0004-repo-and-delivery.md): it doubles the identity and connection setup.
6. **Run it in the conformance tier, every day.** Rejected: it checks the deployed site, which changes on a deploy, and [ADR 15](0015-conformance-tier.md) keeps the tiers apart by what they touch.

## Fitness functions

The first two run in the gate and block a merge. The third is the live check itself, after each deploy. They land with the issue that builds the check, once the owner has made the account and the variable.

| Check | What it asserts | What it catches |
| --- | --- | --- |
| The live tier signs in as one account | The deploy workflow's live job takes the address from `vars.LIVE_TEST_EMAIL` and names no secret, and no `*.live.ts` file reads an environment variable that the live job does not set. | A second account, or a secret, reaching the live tier. |
| The live tier makes no account | No `*.live.ts` file clicks Sign up or calls Clerk's sign-up. Checking that the button is shown is allowed. | A run that uses up the 100 accounts. |
| A person can sign in on the live page | After each deploy, the test account signs in through Clerk's screens and the signed-in page loads its list and the MCP address. | CloudFront dropping the token, a session token the service refuses, or Clerk not sending the person back. |

## Consequences

**Easier**

- A deploy that breaks sign-in, or the signed-in page's first read, shows within minutes of the merge.
- The three risks left open by issue #5 are checked on every deploy.
- A signed-in round trip on the page no longer rests on a hand check. The hand checklist keeps real agents connecting.

**Harder, and accepted**

- The check depends on Clerk's test mode staying on. Test mode also lets anyone sign up with a made-up `+clerk_test` address and no real email, so a script could fill the 100 accounts. That was already true. Now a check depends on it too. A production instance would need a new decision.
- Anyone who learns the address can sign in as the test account, and could connect an agent to it or delete it. It holds nothing that matters. A deleted account turns the check red until the owner makes it again.
- The check drives Clerk's screens, which Clerk can change. A change there fails the check with nothing wrong in askme.
- It runs after the merge, as every live check does. It finds a broken deploy, and it does not prevent one. Rolling back is reverting the pull request ([ADR 4](0004-repo-and-delivery.md)).
- Each run leaves a session in Clerk until it expires, because the page has no way to sign out yet (#28).
- Once "Send sample asks" exists (#17), pressing it would prove a card reaches the page. It writes asks, so that needs a new decision.
