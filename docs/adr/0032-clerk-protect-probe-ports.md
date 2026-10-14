# ADR 32: The page's CSP lets Clerk Protect's probe use any port

Decided on 14 October 2026: `connect-src` names Clerk Protect's hosts as `https://*.client.protect.clerk.com:*`, so its probe may reach them on any port. This amends point 1 of [ADR 30](0030-csp-allows-clerk-protect.md). The owner chose it under #391, after a deploy's live check failed on probes to other ports.

Parent PRD: [PRD](../../PRD.md). Amends [ADR 30](0030-csp-allows-clerk-protect.md).

## Constraint-set delta

Edits [`docs/constraints/content-security-policy.md`](../constraints/content-security-policy.md): the rule naming today's origins gives Clerk Protect's `connect-src` source any port.

## Context

- **A deploy's live check failed on four ports.** In run 38532605514, Clerk Protect's probe went to its own host on ports 8443, 18443, 2082 and 992, twice each. A CSP source with no port matches only port 443, so the policy reported all eight, and the run rolled back.
- **Clerk Protect varies from run to run.** The first failed run probed only port 443, and the two deploys after the failure passed with the same policy. Clerk chooses the ports, and the next run may use others.
- **A deploy fails whenever Clerk picks those ports.** Each failure rolls the site back and blocks the changes in that deploy.

## Decision

`connect-src` lets Clerk Protect's hosts be reached on any port.

1. `connect-src` names `https://*.client.protect.clerk.com:*` in place of `https://*.client.protect.clerk.com`.
2. `script-src` keeps its Clerk Protect sources without a port. Clerk Protect has loaded its scripts only from port 443.
3. The rest of ADR 30 stands.

## Alternatives considered

1. **Name the four ports seen.** It allows less. Rejected: Clerk picks the ports, the first failed run used none of these four, and a port not on the list fails a deploy at random.
2. **Turn off Clerk Protect in Clerk's dashboard.** Rejected for the reasons ADR 30 gives.
3. **Leave the policy and re-run failed deploys.** Rejected: a failure rolls the site back and needs the owner each time, and under the enforcing header those probes would be refused in real browsers.

## Fitness functions

| Check | What it asserts | Where it runs | What it catches |
| --- | --- | --- | --- |
| The page's CSP names only Clerk's origins | As in ADR 30, with Clerk Protect's `connect-src` source written as `https://*.client.protect.clerk.com:*`. | Gate (static) | Clerk Protect's probe ports dropped, or any port allowed on a host other than Clerk Protect's. |

The check is ADR 30's, changed with this record.

## Consequences

**Easier**

- A deploy no longer fails on whichever ports Clerk Protect's probe picks.

**Harder, and accepted**

- A script that gets in can send to Clerk Protect's hosts on any port, not only 443. ADR 30 already lets it send to every instance's Protect host, so this widens the ports, not the hosts.
