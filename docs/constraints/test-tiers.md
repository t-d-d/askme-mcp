# Test tiers
Relevance: Adding or moving a test, a fake or a test script, or editing what runs one: **/*.static.ts, **/*.test.ts, **/*.int.ts, **/*.browser.ts, **/*.live.ts, the gate command, .github/workflows/**
Decision: Five tiers kept apart by file suffix; static, unit, integration and browser form an offline, secret-free gate; live runs after deploy.

Why: Agents write the code, so the gate is the reviewer, and it must
run the same on a laptop and a standard runner. There is one
environment, so nothing deployed can be tested before a merge.

## Rules

- A test's suffix fixes its tier: .static.ts static, .test.ts unit,
  .int.ts integration, .browser.ts browser, .live.ts live.
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
- The live tier signs in to nothing and writes nothing.
- The eval set is not in the gate.

## Do not

- Replace the local DynamoDB with an in-memory fake: the atomic write
  and late expiry are the real store's behaviour.
- Call the real model or identity service from the gate.
- Widen a tier's pattern to bare *.ts.
- Add a second test runner.

Judgment: A signed-in path from a real agent to a card is checked by
hand after a deploy. No test can see it.
History: [ADR 9](../adr/0009-test-pyramid.md)
