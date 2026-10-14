# ADR 28: The page's CSP names every outside origin it uses

Decided on 14 October 2026: CloudFront sends the page a Content-Security-Policy, from a response headers policy of the page's own, that names every outside origin the page loads from or calls. Today that is Clerk's host alone, which the deploy takes from `CLERK_ISSUER`. A pull request that makes the page reach a new origin adds it to the policy. Issue #391 asked for it.

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

Adds [`docs/constraints/content-security-policy.md`](../constraints/content-security-policy.md). The rule gets a file of its own, not a place in [hosting.md](../constraints/hosting.md), because the change that adds an origin is usually in the page's code or its dependencies, and hosting.md's Relevance line does not name those.

## Context

- **The page had no CSP.** `web/index.html` sets none. Both CloudFront behaviours used AWS's managed SecurityHeadersPolicy, which sends HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and `X-XSS-Protection`, but no CSP.
- **A script that got in could act as the person.** The page shows agent text as React text, so no injection path is known. But any script running in the page can call Clerk's `getToken` and use the API as the person.
- **The page reaches two origins.** Its own serves the page and, under `/api`, the API. Clerk's frontend host serves clerk-js and Clerk's UI script and answers their calls. Sign-in and sign-up send the browser to Clerk's hosted pages, so no Clerk frame or captcha runs in the page. The font is bundled.
- **zod tries eval.** zod 4 calls `Function` once to see whether it may compile its parsers. Under a CSP without `'unsafe-eval'` that call is a violation, though zod catches the error. Under a report-only CSP the call works, and zod then compiles each schema with `Function`, one violation each.

## Decision

The page's CSP names every outside origin the page loads from or calls, and lets in nothing else from outside.

1. **Where it is set.** A CloudFront response headers policy, `askme-page`, on the page's default behaviour. It replaces the managed policy there, and sends the same five headers with the same values. The `/api/*` behaviour keeps the managed policy.
2. **The policy.**

   ```
   default-src 'self';
   script-src 'self' <Clerk's host>;
   connect-src 'self' <Clerk's host>;
   img-src 'self' data:;
   style-src 'self' 'unsafe-inline';
   worker-src 'self' blob:;
   frame-ancestors 'none'; object-src 'none'; base-uri 'none'
   ```

   clerk-js starts a worker from a `blob:` address for its timers, and Clerk's UI writes its styles into style elements, so `blob:` and `'unsafe-inline'` for styles stay. A source is added only when a check shows the page needs it.

3. **Clerk's host comes from `CLERK_ISSUER`.** `serverless.yml` writes `${env:CLERK_ISSUER}` into the policy, and the deploy fills it in. Clerk's issuer and its frontend host are the same address, on a development instance and on a production instance with its own domain, so a move needs no edit.
4. **A new origin.** A pull request that makes the page load from or call another origin adds it to the directive for that kind of load, and to the static check's list.
5. **No eval and no inline script.** No directive allows `'unsafe-eval'`, and `script-src` does not allow `'unsafe-inline'`. The page sets zod's `jitless` option before it makes any schema, so zod never calls `Function`.
6. **Report-only first.** The policy goes out first as `Content-Security-Policy-Report-Only`. Once a deploy with it has passed the live check, a second pull request under #391 sends it as `Content-Security-Policy`. A later change that narrows the policy may go out report-only first in the same way.
7. **Who sees a violation.** The browser tier serves the built page with the policy, with Clerk's host swapped for one that resolves nowhere. It fails on any violation on the signed-out page, the list, a card, the rules and Connect your agents. The browser tier fakes Clerk, so the live tier records every `securitypolicyviolation` event on the page's own address during its signed-in run, and fails on any.

## Alternatives considered

1. **No CSP.** Nothing changes and nothing can break. Rejected: the page holds a session that can act as the person, and a CSP still limits a script that gets in.
2. **A meta tag in `web/index.html`.** It needs no change to CloudFront. Rejected: a meta tag cannot carry `frame-ancestors` or report-only, and the rule would be split between the build and the deployment definition.
3. **A CloudFront Function or Lambda@Edge that adds the header.** Rejected: [hosting.md](../constraints/hosting.md) puts no code in front of the page, and a response headers policy sends the same header with none.
4. **A wildcard for Clerk, such as `https://*.clerk.accounts.dev`.** It would survive a change of instance. Rejected: anyone can make a Clerk development instance, so the wildcard lets in scripts from hosts that are not ours. An implementer is likely to reach for it, so it becomes a "Do not" in the constraint file.
5. **Clerk's host written into `serverless.yml`.** It is easier to read. Rejected: a move to a production instance on its own domain would break sign-in until someone edited the file. It becomes a "Do not".
6. **A `report-uri` or `report-to` address.** Violations in real visitors' browsers would reach the service. Rejected: it needs a route that takes writes without a token from any browser, which [identity.md](../constraints/identity.md) rules out. The browser tier and the live check already fail on any violation.
7. **`'unsafe-eval'` for zod.** Rejected: it undoes much of what the policy is for, and zod's `jitless` option makes it unneeded. An implementer quieting a violation is likely to add it, so it becomes a "Do not".
8. **Nonces or hashes with `'strict-dynamic'` in place of a host list.** Rejected: the page is static files on S3, with no server to make a nonce for each response, and Clerk's scripts load further scripts by address.

## Fitness functions

| Check | What it asserts | Where it runs | What it catches |
| --- | --- | --- | --- |
| The page's CSP names only Clerk's host | Read as YAML, `serverless.yml` gives the page's default behaviour a response headers policy of its own, which sends one CSP, report-only or enforcing. Its `default-src` is `'self'`. Every source but a keyword, `data:` in `img-src` and `blob:` in `worker-src` is `${env:CLERK_ISSUER}`. `frame-ancestors`, `object-src` and `base-uri` are `'none'`. No directive allows `'unsafe-eval'`, and `script-src` does not allow `'unsafe-inline'`. | Gate (static) | A new origin, a wildcard or a bare scheme, a Clerk host written into the file, a dropped `default-src`, eval or inline script allowed. |
| The page keeps the managed security headers | The page's policy sends HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and `X-XSS-Protection` with the managed policy's values, and `/api/*` still uses the managed policy. | Gate (static) | A header lost in the swap. |
| The built page breaks no CSP rule | The browser tier serves the built page with the policy, and no `securitypolicyviolation` event fires on the signed-out page, the list, a card, the rules or Connect your agents. | Gate (browser) | The page's own code needing more than the policy allows, such as zod's eval or an inline script. |
| The live page breaks no CSP rule | The live tier hears every `securitypolicyviolation` event on the page's address during its signed-in run, and fails on any. | After each deploy (live) | Clerk's scripts needing more than the policy allows. |
| The page's CSP is enforced | The page's policy sends the CSP as `Content-Security-Policy`, not report-only. | Gate (static) | A policy left report-only, which stops nothing. |

The first four land with this record. The last lands with the second pull request under #391, once a deploy has passed the live check with the report-only header.

## Consequences

**Easier**

- An injected script cannot load code from, or send what it reads to, a host the policy does not name.
- No other site can frame the page.
- A new outside origin shows in review, because the static check fails until the policy and its list name it.
- The browser tier fails before a merge when the page's own code needs more than the policy allows.

**Harder, and accepted**

- Adding a service the page calls means widening the policy in the same pull request. So does mounting one of Clerk's components in the page: they load avatars from `img.clerk.com` and a captcha from `challenges.cloudflare.com`.
- `style-src` allows `'unsafe-inline'` for Clerk's UI, so the policy does not stop injected styles.
- The page loads the newest clerk-js 6 from Clerk's host, so Clerk can change the script with no deploy here. Under the enforcing header, a change that needs a new source breaks sign-in until the policy is widened, and the live check only runs on a deploy.
- In a development instance, clerk-js sends telemetry to `clerk-telemetry.com` from a real person's browser. The policy refuses it, and the request fails quietly. Clerk sends none when the browser is automated, so the live check cannot see it.
- Nothing reports a violation in a real visitor's browser. The browser tier and the live check are the only places one shows.
- zod checks the page's API answers without compiled parsers. The answers are small, so the page is no slower in a way anyone would see.
