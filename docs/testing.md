# How askme is tested

Agents write the code and the owner merges it, so the gate is the reviewer. Whatever the gate cannot see ships. There is one environment, so nothing is tried on a deployed copy before it merges.

This page explains how the tests fit together. The rules they follow are in [test-tiers.md](constraints/test-tiers.md), and the reasons are in [ADR 9](adr/0009-test-pyramid.md), [ADR 15](adr/0015-conformance-tier.md), [ADR 16](adr/0016-live-sign-in.md) and [ADR 20](adr/0020-live-tier-reads.md).

## The tiers

A test's file name sets its tier, and its tier sets what it may touch. An assertion goes in the lowest tier that can see it.

| Tier | File name | May touch | Runs |
| --- | --- | --- | --- |
| Static | `*.static.ts` | The repo's own files, read only | In the gate |
| Unit | `*.test.ts` | Memory only | In the gate |
| Integration | `*.int.ts` | Loopback: the local database, the fake model, test-key tokens | In the gate |
| Browser | `*.browser.ts` | Loopback, with the API faked | In the gate |
| Live | `*.live.ts` | The deployed site, reading only. It may sign in as the one test account. | After each deploy, with `npm run test:live` |
| Conformance | `*.conformance.ts` | Setup outside the repo, such as GitHub's settings, read only | Every day, with `npm run conformance` |

`npm run gate` runs format, lint, types, and the static, unit, integration and browser tests. It runs on every pull request, and again on main before each deploy. Main's ruleset requires it, so a pull request merges only when it passes. The test setup refuses any connection that is not to loopback, and the gate's job declares no secrets.

Vitest runs every tier. The browser tier drives headless Chromium with Playwright, used as a library inside Vitest.

## Stand-ins for outside services

The gate cannot reach the services askme depends on, so each one has a stand-in there. The real one is checked somewhere else.

| Outside service | In the gate | Where the real one is checked |
| --- | --- | --- |
| DynamoDB | DynamoDB Local, run in Docker. An in-memory fake would miss the real store's atomic write and late expiry. | The live tier's signed-in page polls the deployed API, which reads the table. |
| The model, through OpenRouter | A fake at the HTTP edge that serves recorded replies. The code under test still makes a real HTTP call. | The eval set, on demand. |
| Clerk | Tokens signed with a test key, checked by the real verification code. | The live tier signs in through Clerk's own screens, as the one test account. |
| Agents' MCP clients | The official MCP client, connected to the service's handler. | The [checklist for connecting a real agent](agent-checklist.md), by hand. |
| The sort queue and Parameter Store | Fakes on loopback. | Nowhere automated. The live tier only reads, so no test puts a real ask through the queue. |
| GitHub's settings | None. | The conformance tier reads main's ruleset every day. |

## Fitness functions

Each decision record names checks that hold the rules it puts in force. Each check is a test whose describe name is the check's name and its constraint file, such as `fitness: main is protected (repo-and-delivery.md)`. A check sits in the lowest tier that can see it, so most run in the gate. A few run after each deploy, every day, or with the eval.

`npm run checks` lists any check a record names that has no test. It runs by hand, because a record may name checks that land with a later issue.

## The eval set

`npm run eval` sends every ask in the eval set to the real model with the sorting prompt, and scores the replies. It costs money and can change between runs, so it is not in the gate.

The asks are in three groups, each scored on its own line. Core asks come from three areas of one person's life. Timing asks copy a few core asks with only the time changed. Hostile asks try to steer their own sorting ([ADR 12](adr/0012-untrusted-ask-text.md)). There is no pass mark. A change to the sorting prompt or the model needs a run before and after, and both scores go in the pull request.

- `npm run eval:candidates` runs the set across every model in [evals/candidates.ts](../evals/candidates.ts) and saves the scores in [evals/scores.md](../evals/scores.md). The best of them is the default model.
- `npm run eval:trial` sorts every ask several times under a draft wording, so a wording can be tried before a full run.

## Measuring the tests

There is no coverage target ([ADR 9](adr/0009-test-pyramid.md)). Two measures run by hand, outside the gate. A refactoring pull request runs both before and after its move, and puts both sets of figures in its body.

- `npm run coverage` gives each file's line and branch coverage from the unit and integration tiers.
- `npm run mutate -- <suite>` runs StrykerJS over one suite in [test/mutation-suites.ts](../test/mutation-suites.ts). It makes small changes to the code, called mutants, runs the suite's tests against each one, and lists the mutants no test catches. It keeps the last run's survivors beside the new ones, so a run before a refactor and one after it can be compared with diff.

A suite names whole files and the unit and integration tests that guard them. There are eight: `listView`, `view`, `sorter`, `refusalNote`, `rulesState`, `dismissing`, `rate` and `rateLimits`. A suite with an integration test runs one mutant at a time. Under load its tests time out, and Stryker counts a timeout as a catch, which would hide a survivor. A run in which most mutants timed out fails.

The refactoring train in [#225](https://github.com/t-d-d/askme-mcp/issues/225) moved logic out of the page's components into pure functions. A mutation suite runs only unit and integration tests. The browser tier covered those components, but no unit test reached them, so before the move no mutant in them was caught.

| Code moved | Mutants caught before | Mutants caught after |
| --- | --- | --- |
| The list view ([#256](https://github.com/t-d-d/askme-mcp/pull/256)) | 0 of 101 | 82 of 84 |
| The rules screen's state ([#271](https://github.com/t-d-d/askme-mcp/pull/271)) | 0 of 88 | 107 of 108 |
| The dismissal rules ([#277](https://github.com/t-d-d/askme-mcp/pull/277)) | 0 of 100 | 145 of 145 |

Each pull request names its survivors, with the test added for each one or the reason it stays. Some survivors change nothing a caller can see, so no test can catch them.

## Manual checks

The checks that no automated test makes are listed in the [README](../README.md#manual-checks).
