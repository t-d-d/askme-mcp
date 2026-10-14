# Content Security Policy
Relevance: Anything the page loads from or calls outside its own address, a new script, style, font, image or worker source, a Clerk component in the page, or the page's response headers: web/src/**, web/index.html, package.json, the deployment definition
Decision: The page's CSP names every outside origin the page uses, today Clerk's and Clerk Protect's hosts, and the pull request that adds an origin adds it there.

Why: Any script running in the page can call Clerk's getToken and act as
the person. A CSP that names every origin stops a script that gets in from
loading more code, or sending what it reads, anywhere else.

## Rules

- The page's own CloudFront response headers policy, on the default
  behaviour, sends the CSP. The /api/* behaviour keeps AWS's managed
  SecurityHeadersPolicy.
- The page's policy also sends every header the managed policy sends,
  with the same values.
- default-src is 'self'.
- The policy names every outside origin the page loads from or calls, in
  the directive for that kind of load, and no other. Today that is
  Clerk's host, in script-src and connect-src, and Clerk Protect's:
  https://cdn.protect.clerk.com and https://*.client.protect.clerk.com in
  script-src, and https://*.client.protect.clerk.com:* in connect-src,
  since its probe tries several ports.
- Clerk's host is written as ${env:CLERK_ISSUER}, which the deploy fills
  in.
- A pull request that makes the page reach a new origin adds it to the
  policy, and to the static check's list.
- The only schemes allowed are data: in img-src and blob: in worker-src.
- frame-ancestors, object-src and base-uri are 'none'.
- No directive allows 'unsafe-eval', and script-src does not allow
  'unsafe-inline'.
- The page sets zod's jitless option before it makes any schema.
- The policy is sent as Content-Security-Policy, with no
  Content-Security-Policy-Report-Only header. A pull request that
  narrows the policy sends it enforcing. If the live check then fails,
  the run rolls the deploy back (repo-and-delivery.md).
- The browser tier serves the built page with the policy and fails on
  any violation. The live check records every violation on the page's
  address during its signed-in run, and fails on any.

## Do not

- Allow a wildcard such as https://*.clerk.accounts.dev or
  https://*.clerk.com, or a bare scheme such as https:. Anyone can make a
  Clerk instance, so a wildcard lets in hosts that are not ours. Clerk
  Protect's https://*.client.protect.clerk.com is the one exception,
  because Clerk names the host under it for each instance (ADR 30).
- Allow any port, as :* does, on a source other than Clerk Protect's in
  connect-src. Only its probe picks its own ports (ADR 32).
- Write Clerk's frontend host into serverless.yml: a move to a Clerk
  production instance on its own domain would break sign-in until
  someone edited it.
- Add 'unsafe-eval', or 'unsafe-inline' in script-src, to quiet a
  violation. Change what needs it instead, as jitless does for zod.
- Put the CSP in a meta tag: a meta tag cannot carry frame-ancestors.
- Send a Content-Security-Policy-Report-Only header to try a narrower
  policy, in place of the enforcing one or beside it. In its place,
  nothing is enforced while the trial runs. Beside it, every CSP check
  would have to change, for a narrowing that a failed live check
  already rolls back (ADR 34).
- Add the header with a CloudFront Function or Lambda@Edge: hosting.md
  puts no code in front of the page.
- Add a route for report-uri or report-to: it would take writes without
  a token from any browser, which identity.md rules out.

Judgment: No test sees what Clerk needs on a path the live check does not
take, such as a Clerk component in the page, or Clerk's telemetry in a
real person's browser. Clerk serves the newest clerk-js 6 with no deploy
here, so a change Clerk makes can need a new source between deploys.
The live check sees what Clerk Protect loads for a sign-in it does not
challenge, and a challenge may load more.
The checks listen on each page, not in workers, so a pull request that
adds a worker which loads anything checks those loads against the policy
by hand.
History: [ADR 28](../adr/0028-page-csp.md), [ADR 30](../adr/0030-csp-allows-clerk-protect.md), [ADR 32](../adr/0032-clerk-protect-probe-ports.md), [ADR 34](../adr/0034-csp-always-enforced.md)
