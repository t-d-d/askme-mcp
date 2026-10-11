# Test tiers
Relevance: Adding or moving a test, a fake or a test script, or editing what runs one: **/*.static.ts, **/*.test.ts, **/*.int.ts, **/*.browser.ts, **/*.live.ts, **/*.conformance.ts, the gate command, .github/workflows/**
Decision: Six tiers kept apart by file suffix; static, unit, integration and browser form an offline, secret-free gate; live runs after deploy, conformance daily.

Why: Agents write the code, so the gate is the reviewer, and it must
run the same on a laptop and a standard runner. There is one
environment, so nothing deployed can be tested before a merge. Setup
held outside the repo can drift with no pull request at all, and most
of it can only be read signed in.

## Rules

- A test's suffix fixes its tier: .static.ts static, .test.ts unit,
  .int.ts integration, .browser.ts browser, .live.ts live,
  .conformance.ts conformance.
- A fitness function that reads the repo's own files is a static test.
  One that needs running code goes in the lowest tier that can run it.
- An assertion goes in the lowest tier that can see it.
- The gate reaches loopback only and holds no secrets.
- Integration tests use a real DynamoDB run locally.
- The model is faked at the HTTP edge with recorded replies.
- Identity tokens are signed with a test key and verified by the real
  verification code.
- MCP is tested through the official client.
- One runner for the repo. Playwright is used as a library.
- The live tier checks the deployed site. It signs in to nothing and
  writes nothing.
- The conformance tier checks that setup held outside the repo, such
  as GitHub's settings, still matches what the repo records. It runs
  every day and writes nothing. It may sign in, with the narrowest
  credential the service offers: one that only reads where there is
  one. A job that uses a stored key or an AWS token runs in the GitHub
  environment "conformance", which only main may use, and its keys are
  that environment's secrets. The workflow's own read-only token needs
  no environment.
- The eval set is not in the gate.

## Do not

- Replace the local DynamoDB with an in-memory fake: the atomic write
  and late expiry are the real store's behaviour.
- Call the real model or identity service from the gate.
- Widen a tier's pattern to bare *.ts.
- Add a second test runner.
- Put a check of outside setup in the live tier: the live tier is for
  the deployed site, and says what its files touch.
- Give a conformance check the deploy role: it only reads, and the
  deploy role can change everything.
- Give a conformance check a key that can write when the service
  offers one that only reads.

Judgment: A signed-in path from a real agent to a card is checked by
hand after a deploy, and how narrow a third-party conformance key is
when it is made. No test can see either.
History: [ADR 9](../adr/0009-test-pyramid.md), [ADR 15](../adr/0015-conformance-tier.md)
