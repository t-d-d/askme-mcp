# Working in this repo

askme.mcp is one place where all of a person's AI agents ask for their input, sorted by rules the person writes in plain English.

- [PRD.md](PRD.md) says what version 1 does and what it leaves out.
- [docs/adr/](docs/adr/README.md) says why each technical decision was made.
- [docs/constraints/](docs/constraints/README.md) holds the rules in force.

## Scope

- The PRD's "Out of scope" list is binding. Do not build a roadmap item.
- Work you find in passing becomes an issue. Do not fix it in the branch you are on.

## Before any code edit

- Run the `constraints` skill. Config, the deployment definition and `package.json` count as code.
- If the task conflicts with a constraint, stop and say so. Do not work around the rule, and do not quietly follow the task.
- A change to what a constraint means needs a decision record (`write-an-adr` skill) and the owner's agreement.

## Tests first

- Write the failing test first. Watch it fail for the reason you expect, then write the code.
- A test's file name sets its tier ([ADR 9](docs/adr/0009-test-pyramid.md), [ADR 15](docs/adr/0015-conformance-tier.md), [ADR 16](docs/adr/0016-live-sign-in.md)).

| Tier | File name | May touch |
| --- | --- | --- |
| Static | `*.static.ts` | The repo's own files, read only |
| Unit | `*.test.ts` | Memory only |
| Integration | `*.int.ts` | Loopback: the local database, the fake model, test-key tokens |
| Browser | `*.browser.ts` | Loopback, with the API faked |
| Live | `*.live.ts` | The deployed site, writing nothing to askme's store. It may sign in, or sign up once, as the one test account (ADR 16) |
| Conformance | `*.conformance.ts` | Setup outside the repo, such as GitHub's settings, read only, signed in where needed (ADR 15) |

- An assertion goes in the lowest tier that can see it.
- A fitness function names its constraint file in its describe name: `fitness: <what it asserts> (<file>.md)`.
- Never weaken or delete a test to get the gate green.

## The sorting prompt

- The eval set comes before the prompt. Write or extend the eval cases first.
- `npm run eval` runs the eval set against the real model. It works on a branch, in a cloud session or on a laptop.
- In a cloud session the eval key is a network secret on the environment. The session never sees it. It is added to requests for openrouter.ai after they leave the session, so the command sends no key of its own there.
- On a laptop the command reads `OPENROUTER_API_KEY`.
- The eval key is separate from the live service's, and has a small spending limit.
- A change to the sorting prompt or the model needs a run before and after. Put both scores in the pull request.
- A run spends money, against a key with a small limit. Run the set across several models only when the issue asks for it.

## The gate

- `npm run gate` runs everything: lint, types, tests, browser tests and fitness functions. It is the same command in CI.
- The gate is offline and holds no secrets. A test that needs the network or a key belongs to another tier.

## Branches and pull requests

- Never push to main. One branch per issue.
- Run the `pre-push` skill before every push. It ends by raising the pull request.
- The pull request body follows the `pr-description` skill.
- Nothing deploys except a green merge to main. Never deploy by hand.
- The owner merges. Do not merge your own pull request.

## Issues

- Given an issue number, run the `fetch-ticket` skill first.
- Labels are written with a space after the colon: `type: enhancement`, `type: nfr`, `type: chore`, `type: qa` or `type: bug`, and `mode: afk` or `mode: human`.
- Blockers are listed on a `Blocked by:` line at the top of the issue body. Do not start an issue whose blocker is open.
- An afk issue goes from its text to a pull request without stopping to ask.
- Anything only the owner can do is not yours: a dashboard setting, a secret, a phone, connecting a real agent. Say what is needed and stop.
- When you stop with nobody watching, say why in a comment on the issue. A stop that is written nowhere reaches nobody.
- Acceptance criteria are not yours to rewrite. If one cannot be met as written, say so under Drift in the pull request.

## GitHub from a cloud session

- Read the `github-tooling` skill before any `gh` command. `gh issue` and `gh pr` fail in a cloud session.
- A session has no cloud credentials and cannot read the repo's secrets or variables. Code refers to them by the names the issue gives. If a task needs a value, stop and say so.

## The page

- [docs/design.md](docs/design.md) is the design. A change to the page follows it: its colours, sizes, parts, states and words.
- [docs/design/mockup/](docs/design/mockup/index.html) has every screen as a static page, and [docs/design/screens/](docs/design/screens/) as pictures.
- Before pushing a change to the page, open it at 390px wide in headless Chromium and compare it with the mockup. Look for anything cut off, wrapped or misaligned.
- If the design does not cover what you are building, follow its nearest part and say so under Drift. Do not invent a new colour, size or part.

## Writing

- Plain words and whole sentences. No em dashes.
- Run the `unslop` skill over anything a person will read: pull request bodies, issues, docs, the README, text on the page.
