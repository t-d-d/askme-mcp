# ADR 30: The page's CSP lets in Clerk Protect's hosts

Decided on 14 October 2026: the page's CSP also names the hosts of Clerk Protect, Clerk's bot protection. `script-src` gains `https://cdn.protect.clerk.com` and `https://*.client.protect.clerk.com`, and `connect-src` gains `https://*.client.protect.clerk.com`. That wildcard is the only one the policy allows. This amends point 2 of [ADR 28](0028-page-csp.md) and its "Do not" against wildcards. The owner chose it under #391, after the first deploy with the report-only header failed its live check.

Parent PRD: [PRD](../../PRD.md). Amends [ADR 28](0028-page-csp.md).

## Constraint-set delta

Edits [`docs/constraints/content-security-policy.md`](../constraints/content-security-policy.md): its Decision line and the rule naming today's origins add Clerk Protect's hosts, and the "Do not" against wildcards makes `https://*.client.protect.clerk.com` its one exception.

## Context

- **The live check failed on the first deploy with the policy.** clerk-js loaded Clerk Protect into the signed-in page: a script from `cdn.protect.clerk.com`, then a loader from `<id>-l.client.protect.clerk.com`, and two probes to `<id>-p.client.protect.clerk.com`. The policy reported all four, and the run rolled back to `live-ok`.
- **Clerk's server names these hosts, not the bundle.** clerk-js reads them from `protect_config` in the environment that Clerk's frontend API serves for the instance. ADR 28 read the clerk-js bundle and missed them.
- **The subdomain is the instance's.** It cannot be derived from `CLERK_ISSUER`, and Clerk can change it with no deploy here.
- **Every deploy from main fails until the policy allows them.** Each one rolls back, so no change reaches the live site.

## Decision

The page's CSP names Clerk Protect's hosts as well as Clerk's frontend host.

1. `script-src` adds `https://cdn.protect.clerk.com` and `https://*.client.protect.clerk.com`. `connect-src` adds `https://*.client.protect.clerk.com`.
2. The wildcard covers only the hosts under `client.protect.clerk.com`, the domain where Clerk serves its Protect code for each instance. Clerk picks the name under it, so no exact host can be written down. It is the one wildcard the policy allows.
3. The rest of ADR 28 stands, including its rule against other wildcards such as `https://*.clerk.accounts.dev`.

## Alternatives considered

1. **Name the instance's hosts exactly.** No wildcard. Rejected: Clerk's config gives the names, they cannot be derived from `CLERK_ISSUER`, and a change Clerk makes would break Clerk Protect between deploys under the enforcing header.
2. **Narrow each source to the instance's path,** as in `https://*.client.protect.clerk.com/ins_<id>/`. Every address Clerk Protect used starts with the instance's id, so other instances' hosts would be refused. Not taken here: the id is not in `CLERK_ISSUER`, so it needs a repo variable only the owner can set, and Clerk could change the paths with no deploy here. It stays open as a later narrowing.
3. **Turn off Clerk Protect in Clerk's dashboard.** The policy stays as ADR 28 wrote it. Rejected: sign-in and sign-up lose Clerk's bot protection, and the setting lives outside the repo, where no check sees it.
4. **Allow `https://*.clerk.com`.** Fewer entries. Rejected: it covers every Clerk host, not only Clerk Protect's. An implementer widening for the next Clerk host is likely to reach for it, so the constraint file names it under "Do not".
5. **Revert the CSP.** Deploys pass again at once. Rejected for the reason ADR 28 gives against having no CSP.

## Fitness functions

| Check | What it asserts | Where it runs | What it catches |
| --- | --- | --- | --- |
| The page's CSP names only Clerk's origins | Read as YAML, `serverless.yml`'s page policy names no outside source but `${env:CLERK_ISSUER}` in `script-src` and `connect-src`, `https://cdn.protect.clerk.com` in `script-src`, and `https://*.client.protect.clerk.com` in `script-src` and `connect-src`. It names all three Clerk Protect sources. The rest is as in ADR 28's "The page's CSP names only Clerk's host". | Gate (static) | A new origin, a wildcard other than Clerk Protect's, or Clerk Protect's hosts dropped. |

It replaces ADR 28's "The page's CSP names only Clerk's host", and lands with this record. ADR 28's other checks stand.

## Consequences

**Easier**

- Deploys pass the live check again, unless Clerk loads something else.
- Sign-in and sign-up keep Clerk's bot protection.

**Harder, and accepted**

- Any Clerk instance's Protect host can load script into the page. Those hosts serve Clerk's code, so this is the trust the page already gives Clerk's frontend host, across a whole domain.
- A script that gets in can send what it reads to any Clerk instance's Protect host, not only ours. What then reaches whoever made that instance depends on what Clerk shows them, which no one here controls.
- The live check sees what Clerk Protect loads for a sign-in it does not challenge. A challenge may load more, such as a frame, which the policy refuses. Nobody here can make the live check's sign-in be challenged.
- If Clerk moves Clerk Protect to another domain, the next deploy's live check fails and rolls back. Under the enforcing header, Clerk Protect is blocked from the move until the policy is widened.
