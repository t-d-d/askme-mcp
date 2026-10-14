# Content Security Policy
Relevance: Anything the page loads from or calls outside its own address, a new script, style, font, image or worker source, a Clerk component in the page, or the page's response headers: web/src/**, web/index.html, package.json, the deployment definition
Decision: The page's CSP names every outside origin it loads from or calls, today Clerk's host alone, and a new origin is added in the pull request that needs it.

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
  Clerk's host, in script-src and connect-src.
- Clerk's host is written as ${env:CLERK_ISSUER}, which the deploy fills
  in.
- A pull request that makes the page reach a new origin adds it to the
  policy, and to the static check's list.
- The only schemes allowed are data: in img-src and blob: in worker-src.
- frame-ancestors, object-src and base-uri are 'none'.
- No directive allows 'unsafe-eval', and script-src does not allow
  'unsafe-inline'.
- The page sets zod's jitless option before it makes any schema.
- The policy is sent as Content-Security-Policy. A new or narrower
  policy may go out first as Content-Security-Policy-Report-Only, until
  a deploy has passed the live check with it.
- The browser tier serves the built page with the policy and fails on
  any violation. The live check records every violation on the page's
  address during its signed-in run, and fails on any.

## Do not

- Allow a wildcard such as https://*.clerk.accounts.dev, or a bare scheme
  such as https:. Anyone can make a Clerk instance, so a wildcard lets in
  hosts that are not ours.
- Write Clerk's host into serverless.yml: a move to a Clerk production
  instance on its own domain would break sign-in until someone edited it.
- Add 'unsafe-eval', or 'unsafe-inline' in script-src, to quiet a
  violation. Change what needs it instead, as jitless does for zod.
- Put the CSP in a meta tag: a meta tag cannot carry frame-ancestors or
  report-only.
- Add the header with a CloudFront Function or Lambda@Edge: hosting.md
  puts no code in front of the page.
- Add a route for report-uri or report-to: it would take writes without
  a token from any browser, which identity.md rules out.

Judgment: No test sees what Clerk needs on a path the live check does not
take, such as a Clerk component in the page, or Clerk's telemetry in a
real person's browser. Clerk serves the newest clerk-js 6 with no deploy
here, so a change Clerk makes can need a new source between deploys.
The checks listen on each page, not in workers, so a pull request that
adds a worker which loads anything checks those loads against the policy
by hand.
History: [ADR 28](../adr/0028-page-csp.md)
