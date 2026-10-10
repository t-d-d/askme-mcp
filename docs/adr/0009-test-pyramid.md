# ADR 9: Five test tiers, four of them in an offline gate

Decided on 9 October 2026: tests sit in five tiers, kept apart by file name. Four run in the gate, offline and with no secrets. The fifth runs against the live environment after each deploy. How well the model sorts is measured by the eval set, outside the pyramid.

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

Adds [`docs/constraints/test-tiers.md`](../constraints/test-tiers.md).

## Context

- **The gate is the reviewer.** Agents write the code and one person merges it ([ADR 4](0004-repo-and-delivery.md)). Whatever the gate cannot see ships.
- **There is one environment.** Nothing can be tried against a deployed copy before it merges.
- **The gate must run anywhere.** It is one command, on a laptop and on a standard runner, so it cannot need a cloud account, a model key or an identity service secret.
- **Three things sit outside the code:** the model, the identity service, and the agents' own clients. Each needs a stated stand-in inside the gate, and a stated place where the real thing is checked.

## Decision

A test's file name fixes its tier, and its tier fixes what it may touch.

| Tier | File name | What it checks | What it may touch | When it runs |
| --- | --- | --- | --- | --- |
| Static | `*.static.ts`, and none for types and lint | Types and lint, at the strictness [ADR 10](0010-types-and-lint.md) sets, and the fitness functions that read the repo itself: its configuration, its deployment definition, its workflows and its source text | The repo's files, read only | Gate |
| Unit | `*.test.ts` | Pure logic: time windows, ordering, fingerprints, schemas, the logger's allowlist | Memory only | Gate |
| Integration | `*.int.ts` | The API routes and MCP tools from end to end inside one process | Loopback only: a local DynamoDB, and local fakes for the model and the identity service | Gate |
| Browser | `*.browser.ts` | The built page in headless Chromium: polling, cards, swiping and held asks | Loopback only, with the API faked | Gate |
| Live | `*.live.ts` | The deployed service: the page loads, the API answers, and the MCP endpoint gives its 401 and metadata | The live environment, signed out | After each deploy |

**Rules**

1. **An assertion goes in the lowest tier that can see it.**
2. **The gate is offline and holds no secrets.** The test setup refuses any connection that is not to loopback.
3. **The store is a real DynamoDB, run locally.** [ADR 3](0003-idempotency.md)'s race and [ADR 5](0005-hosting.md)'s expiry depend on how the real store behaves. The gate starts and stops it itself, in Docker, and starts the Docker daemon first where one is not already running.
4. **The model is a local fake at the HTTP edge**, serving recorded replies. The code under test still makes a real HTTP call.
5. **Identity uses tokens signed with a test key.** They pass through the same verification code as real ones.
6. **MCP is tested through the official client**, never through hand-written protocol messages. Whether a real client can use the server is part of what is tested.
7. **One test runner serves the whole repo**: Vitest. The browser tier uses Playwright as a library inside it.
8. **The live tier signs in to nothing and writes nothing.** A signed-in round trip is proved by hand, with the checklist in [ADR 6](0006-identity.md).
9. **There is no coverage target.** The fitness functions named in the ADRs are the obligations.
10. **The eval set is not a tier.** It calls the real model, costs money and can change between runs, so it runs on demand.

## Alternatives considered

1. **Mostly end-to-end tests against the deployed service.** They test what users get. Rejected: the only deployed service is the live one, so they would run after the merge, need secrets, and be slow. That is too late for a gate.
2. **An in-memory fake of the store.** It needs nothing installed and is faster. Rejected: the atomic write and the late deletion of expired items are behaviours of the real store. A hand-written fake would pass because it was written to. An implementer is likely to suggest this, so it becomes a "Do not" in the constraint file.
3. **Call the real model in the gate.** Rejected: it costs money, needs a secret, and can change between runs. That job belongs to the eval set.
4. **A runner for each tier.** Each tool's own runner has conveniences. Rejected: several configurations and report formats, for a small repo.
5. **A second environment for tests before merge.** Rejected in [ADR 4](0004-repo-and-delivery.md).

## Fitness functions

All five run in CI and block a merge.

| Check | What it asserts | What it catches |
| --- | --- | --- |
| Tiers stay apart | Each tier's file pattern matches only its own suffix, and no file matches two. | A live test swept into the gate. |
| The gate is offline | The test setup refuses any connection that is not to loopback, and the gate passes. | A test that quietly calls a real service. |
| The gate holds no secrets | The gate's workflow job declares no secrets. | A test that depends on a key. |
| MCP goes through a real client | Every MCP integration test uses the official client. | Tests that pass against a server no real client could use. |
| Every ADR check exists | Each constraint file is cited by at least one test, by name. | A decision whose checks were never written. |

## Consequences

**Easier**

- The gate is fast, repeatable and free to run on a standard runner.
- A failure points to a tier, and so to the kind of thing that broke.
- An agent adding a test knows where it goes.

**Harder, and accepted**

- Running DynamoDB locally needs Docker in three places: the laptop, the standard runner, and the cloud sessions where agents develop. A Claude cloud session has Docker installed but does not start its daemon. Checked on 9 October 2026 in one such session: the daemon started by hand, the image pulled, and the local store answered a request. If Docker is ever unavailable there, the same local DynamoDB runs directly on Java, which the session also has. Either way it adds start-up time to the gate.
- The fakes for the model and the identity service can drift from the real services. The live tier, the hand checklist and the eval set are the counterweights.
- Nothing automated proves a signed-in path from a real agent to a card. That is the largest gap, and it is covered only by the hand checklist.
- The hand checklist depends on someone running it after a deploy.
- With no coverage target, untested code is found only by reading.
