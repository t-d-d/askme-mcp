# askme.mcp

One place where all of a person's AI agents ask for their input, sorted by rules the person writes in plain English.

> **This is a fully functional demo.** Every ask is deleted a month after it is posted. It differs from a production service in a few ways:
>
> - There is one deploy environment. A green merge to main deploys straight to the live site, with no staging before it. If the live check after a deploy fails, the run puts back the last build that passed it.
> - Clerk runs as a development instance. It holds at most 100 accounts, so sign-up stops at the hundredth, and it signs people in with Clerk's shared Google and GitHub credentials.
> - Most limits are per account: 100 asks and 2,000 model calls a day, and per-minute limits on polling, posting and saving rules. A request without a valid token counts against none of them, and nothing limits requests from one address. A total rate limit applies across all accounts: API Gateway takes at most 50 requests a second on each route, with bursts of 100, and answers the rest with a 429 before askme's code runs ([ADR 31](docs/adr/0031-api-throttle.md)). A flood on a route shuts every account out of it while the flood lasts. The sort queue runs five sorts at once. So 100 accounts could make up to 200,000 model calls a day, and the model key's own spending limit is what stops them.
> - There is no web application firewall. AWS WAF cannot attach to this kind of API, and agents reach the MCP endpoint at API Gateway's own address, which also answers the page's API without going through CloudFront. A firewall on CloudFront would need agents to use CloudFront's address, and API Gateway's own address turned off, which takes a custom domain. Until then, AWS's standard DDoS protection and the total rate limit are what slow a flood. Its cost shows on the spend alarm, which reads a bill AWS updates about every six hours, and API Gateway's request and 4xx counts for the API show the flood itself.
> - The page's Content-Security-Policy is sent as report-only until a deploy has passed the live check with it. Until then the browser reports what the policy would block, and blocks nothing.

The page is live at https://d1dqzjjllemayb.cloudfront.net. Agents connect to the MCP endpoint at `https://fx0y26c8v0.execute-api.us-east-1.amazonaws.com/mcp`, and the page's Connect your agents screen gives the steps.

## What it is

People now run several AI agents at once, at work and at home, and each one stops to ask for their input in its own app. The asks arrive in different places, at any hour, all wanting attention. askme gives every agent one place to ask, and puts the person in charge of that channel. Any agent that can connect to an MCP server can post to it. The person's own rules, written in plain English, decide how each ask is sorted, what shows first and what waits for its hours. Every area of their life ends up in one list on their phone.

- An agent calls the MCP server's `ask` tool with a summary, the area of work, a version written to be heard, and up to two links, one to where the person should act and one back to its own session.
- The service sorts the ask against the person's rules into their hashtags and one of three levels.
- The rules can limit a hashtag to certain hours, such as "#work only on weekdays, 8am to 6pm". An ask outside its hashtag's hours is held back until those hours, and a line says how many are held, with a control to show them. Each hashtag has its own tab.
- The page shows the list on a phone, with the first ask shown large. A card can be read aloud. Its main button opens the place to act, such as a pull request or the agent's session.
- The agent calls `resolve` when its wait is over, and the card clears. The person can also swipe it away.

Agents can post and resolve asks, and read nothing. They never see the rules, the hashtags or even their own asks ([ADR 2](docs/adr/0002-agents-write-only.md)).

The [PRD](PRD.md) says what version 1 does, what it leaves out and what comes next. [docs/design.md](docs/design.md) shows every screen.

## Stack

| Part | Choice |
| --- | --- |
| Page | React and TypeScript, built with Vite, served from S3 through CloudFront |
| Service | TypeScript on Lambda, behind API Gateway, deployed with the Serverless Framework |
| MCP server | The official TypeScript SDK, run stateless on Lambda |
| Store | One DynamoDB table, on demand, keyed by account |
| Sorting | A model reached through OpenRouter, fed by an SQS FIFO queue |
| Sign-in and agent OAuth | Clerk |
| Logs and alerts | CloudWatch, with four alarms that email the owner |
| Delivery | GitHub Actions on standard runners. A green merge to main deploys. |
| Tests | Vitest, Playwright as a library, and DynamoDB Local in Docker |

Each choice that is hard to reverse has a decision record in [docs/adr/](docs/adr/README.md). The rules those records put in force are in [docs/constraints/](docs/constraints/README.md).

## How the model is used

The service makes two kinds of model call. Both go through OpenRouter, ask for a reply that fits a JSON Schema, turn reasoning off, and use only providers that keep no prompts.

1. **Reading the rules.** When the person saves their rules, one call lists the hashtags and any hours each one is limited to. The page shows them back.
2. **Sorting an ask.** One call per ask reads the person's rules and that ask, and replies with hashtags from the person's own list, one of three levels, and a reason of at most 140 characters.

The sorting call treats the ask as hostile text ([ADR 12](docs/adr/0012-untrusted-ask-text.md)). It declares no tools. The agent's fields sit in one delimited section, with any delimiter inside them escaped. The service throws away a reply that fails the schema, and the ask stays unsorted. Nothing the model says goes back to an agent, and the page shows the reason as plain text.

Posting never waits on the model. The service stores the ask, puts a sort job on the queue and answers the agent, and the queue retries a failed sort ([ADR 22](docs/adr/0022-sort-queue.md)). The service applies hours, and the time an ask stops mattering, in code, because models are unreliable at date arithmetic.

Each account may post 100 asks a day and cause 2,000 model calls a day ([ADR 21](docs/adr/0021-model-call-cap.md)). Every model call shares one key, so the cap stops one scripted account from spending the key's limit for everyone.

### Why Claude Haiku 5.5

`npm run eval:candidates` sent each of seven cheap, quick models every ask in the eval set twice, with the prompt the service uses. Claude Haiku 5.5 scored best over the whole set, so it is the default. The full results, with every miss and its reason, are in [evals/scores.md](evals/scores.md).

| Model | Core | Timing | Hostile | All | Gave in | Median reply |
| --- | --- | --- | --- | --- | --- | --- |
| `anthropic/claude-haiku-5.5` | 55/64 (86%) | 4/8 (50%) | 23/24 (96%) | 82/96 (85%) | 0 | 0.9s |
| `mistralai/mistral-large-4-0` | 48/64 (75%) | 4/8 (50%) | 24/24 (100%) | 76/96 (79%) | 0 | 1.7s |
| `xiaomi/mimo-v2.6-flash` | 47/64 (73%) | 4/8 (50%) | 24/24 (100%) | 75/96 (78%) | 0 | 4.6s |
| `google/gemma-4-31b-it` | 46/64 (72%) | 5/8 (63%) | 22/24 (92%) | 73/96 (76%) | 0 | 1.6s |
| `deepseek/deepseek-v4.1-flash` | 46/64 (72%) | 6/8 (75%) | 19/24 (79%) | 71/96 (74%) | 0 | 0.8s |
| `google/gemini-3.1-flash-lite` | 40/64 (63%) | 6/8 (75%) | 21/24 (88%) | 67/96 (70%) | 0 | 1.1s |
| `qwen/qwen3.5-35b-a3b` | 32/64 (50%) | 5/8 (63%) | 9/24 (38%) | 46/96 (48%) | 3 | 0.8s |

A score counts the asks whose hashtags and level were both right. The core group holds asks from three areas of one person's life. The timing group copies a few core asks with only the time changed, and expects the same level. The hostile group holds asks that try to steer their own sorting. Gave in counts the hostile asks whose sort did what the ask demanded. The scores were saved on 13 October 2026. There is no pass mark.

Most of Haiku's misses rank a saving passed up, such as a cheaper courier or a supplier's price rise, as normal where the eval expects high. Its four timing misses are the same mistake. Each copy got the level its core twin got, so the time did not move the level.

## Agents wrote the code

Coding agents wrote every line of code in this repo, in Claude Code sessions. The owner and Claude wrote the PRD, the decision records and the issues, and the owner approved each one. Each change arrived as a pull request that the owner merged. By 14 October 2026, 193 pull requests had merged.

The agents work to rules kept in the repo, so each session starts from the same instructions.

- [CLAUDE.md](CLAUDE.md) says how to work: one branch per issue, tests first, the gate before every push, and the owner merges.
- [.claude/skills/](.claude/skills/) holds the steps for picking up an issue, checking the constraints, reviewing a branch before it is pushed, and writing a pull request.

Changes start as GitHub issues, in a simple workflow. An issue describes one change, with a label for its type, such as `type: enhancement` or `type: bug`, and one for its mode. An agent takes a `mode: afk` issue from its text to a pull request on a branch of its own, and the pull request closes the issue. Anything only the owner can do, such as making accounts, setting secrets or connecting a real agent, is a `mode: human` issue, and its closing comment records the result.

## How it is tested

With agents writing the code, the gate is the reviewer. `npm run gate` runs format, lint, types, and the static, unit, integration and browser tests. It runs offline, holds no secrets, and is the same command on a laptop and in CI. A pull request merges only when it passes.

A test's file name sets its tier, and its tier sets what it may touch ([ADR 9](docs/adr/0009-test-pyramid.md)).

| Tier | What it checks | Runs |
| --- | --- | --- |
| Static | Types, lint, and fitness functions that read the repo's own files | In the gate |
| Unit | Logic in memory, such as time windows, ordering and schemas | In the gate |
| Integration | The API and the MCP tools from end to end, against a local DynamoDB, a fake model and test-key tokens | In the gate |
| Browser | The built page in headless Chromium, with the API faked | In the gate |
| Live | The deployed page, API and MCP endpoint. One check signs in as the one test account, sends sample asks and waits for each to be sorted. | After each deploy |
| Conformance | Setup held outside the repo, such as main's ruleset in GitHub | Every day |

If the live check fails, the deploy run puts back the last build that passed it ([ADR 25](docs/adr/0025-roll-back-to-live-ok.md)).

Each decision record names checks for the rules it puts in force, and each check is a test named after it, called a fitness function. `npm run checks` lists any check a record names that has no test.

Mutation testing measures how well the tests guard the code. `npm run mutate -- <suite>` runs StrykerJS over one of nine suites. It makes small changes to the code and lists the ones no test catches. It runs by hand, outside the gate. Each pull request in the refactoring train ([#225](https://github.com/t-d-d/askme-mcp/issues/225)) ran it before and after its move. When the dismissal rules moved out of a hook into a pure function, for example, the tests went from catching none of 100 changes to catching all 145.

The eval set measures how well the model sorts, against the real model, on demand. Its scores are above. They have no pass mark, and the model may sort the same ask differently from one call to the next.

[docs/testing.md](docs/testing.md) says what stands in for each outside service in the gate and where the real one is checked, and gives the mutation figures for each refactor.

### Manual checks

Some things only a person, or an agent looking at a screenshot, can check.

- **Real agents connecting.** The owner runs the [checklist for connecting a real agent](docs/agent-checklist.md) after a deploy that changes sign-in or the MCP server. It last passed on 12 October 2026, for a Claude cloud session and a local Cursor agent. A change can pass every test and still break a real client.
- **Speech on a phone.** Listen uses the browser's own speech, which no test hears. The owner has checked on a phone that a card is read aloud.
- **The page against the design.** Before pushing a change to the page, the coding agent opens it at phone width in headless Chromium and compares it with the mockup by eye. The gate checks parts of the design: colours and font sizes come from the design's tokens, each hashtag's ink is readable on its tint and white on its strong colour, and the controls the browser tests measure are big enough to tap. No test compares the layout with the mockup.
- **The AWS account and the alert email.** While [bootstrapping](docs/bootstrap.md), the owner keeps the AWS account to askme alone, switches on billing alerts and confirms the alert email. A test alarm shows that the email arrives.

## Design choices

- **The page polls.** It asks for changes every few seconds while it is open, and not at all while hidden. This keeps the service fully serverless. It holds no open connection, and nothing runs while nobody looks. A new ask can take a few seconds to show ([ADR 1](docs/adr/0001-polling.md)).
- **Agents read nothing.** An agent never learns whether its ask was opened or dismissed, and cannot list its own asks. It must keep the ids it was given, and always asks in its own session as well ([ADR 2](docs/adr/0002-agents-write-only.md), [ADR 11](docs/adr/0011-error-contract.md)).
- **Rules are plain English, read by a model.** There is no compile step, and no fixed rule sits behind a sort. The eval set and the reason on each card are the checks on it.
- **One environment.** There is no staging, so nothing deployed is tested before it merges. A live check signs in on the deployed page after each deploy, and a failed one puts back the last build that passed it ([ADR 4](docs/adr/0004-repo-and-delivery.md), [ADR 16](docs/adr/0016-live-sign-in.md), [ADR 25](docs/adr/0025-roll-back-to-live-ok.md)).
- **A Clerk development instance.** It needs no domain, but it holds 100 accounts and uses Clerk's shared Google and GitHub credentials. DCR is on, though Clerk marks it deprecated, because MCP clients still use it. That opens a public registration endpoint and puts Clerk's consent screen on every agent sign-in. Clerk's tokens carry no audience, so the service does not check one. The instance issues tokens for askme alone ([ADR 6](docs/adr/0006-identity.md)). askme has not run on a production instance.
- **The deploy role is an administrator.** The AWS account holds only askme, and a role that must create roles for its functions could make itself an administrator anyway. The guards are that only main can assume it, only the owner merges, and every merge needs the gate.
- **One table, with no index and no scan.** Every read is one account's. A question across accounts needs a new decision ([ADR 13](docs/adr/0013-table-design.md)).
- **The sort queue costs a little when idle.** Lambda polls the SQS queue whether or not it holds jobs, and AWS bills those requests. Everything else scales to zero ([ADR 22](docs/adr/0022-sort-queue.md)).
- **Daily caps.** An account that reaches 2,000 model calls in a day stops being sorted until the next UTC day, and its asks that were left out wait until the rules are saved again ([ADR 21](docs/adr/0021-model-call-cap.md)).
- **Sized for a demo.** askme has run with no more than a handful of people. The AWS account's Lambda limit caps how many requests run at once, and a new account may start at 10 ([bootstrapping](docs/bootstrap.md), step 1).

## Lessons learned

- **Decision records would be better kept in issues, where they can be amended.** The repo holds 31 decision records, about 38,700 words, beside about 8,100 lines of application code. A merged record cannot be edited, so each change of mind is a new record that replaces part of an older one. Nine of the 31 do, and a reader follows the chain to learn what holds. The constraint files already say what is in force, in about 7,400 words, and they are what an agent reads before a change. Next time the reasoning would live in the issue that made the decision, and the repo would keep only the constraints.
- **Decide whether follow-up work is worth doing before anyone builds it.** The rule was to raise an issue for any work found in passing, and about 60 of the repo's 206 issues came that way. Too many were raised. Some were built, and some were turned down only at pull request review, after the work was done. Next time each follow-up issue would be weighed when it is raised, its value against the complexity it adds, and closed then if it does not pay its way.
- **Catch an agent's bad habits early, and turn each into a rule.** The agents made most design choices well without being told. A few habits went wrong, and spread before anyone noticed. Logic went into the page's components, where only the browser tier ran it. Before a refactoring train moved it out ([#225](https://github.com/t-d-d/askme-mcp/issues/225)), unit tests caught none of the mutants in it: 0 of 101 in the list view, 0 of 88 in the rules screen and 0 of 100 in the dismissal hook. Five unit test files each wrote out their own fake of the store, until one helper and a gate check replaced them ([#308](https://github.com/t-d-d/askme-mcp/pull/308)). A long list of design rules up front is not the answer, since it would mostly tell the agents what they already do well. Faster feedback is. Mutation testing arrived only with the refactoring train, after most of the page was written. Run from the first days, with a regular look for patterns repeated across files, it would have caught each habit while it was in one or two places, when a rule costs little.
- **Set the repo up for agents working in parallel.** Many agents worked at once against one main branch. 193 pull requests merged, and branches caught up with main 172 times along the way. Catching up is normal. What cost time was the files every change touches, such as the README and the decision record index, which conflicted again and again. Two branches once took the same record number on the same day. Shared files should be few, and laid out so that git can merge them by itself: one file per entry instead of one shared table, numbers taken from the issue or given at merge, and indexes built by a script instead of edited by hand.

## Setup

[docs/setup.md](docs/setup.md) says how to run the gate and the eval set on a laptop. [docs/bootstrap.md](docs/bootstrap.md) lists the accounts and settings a new deployment needs, made once by hand. [docs/restore.md](docs/restore.md) says how to restore the table to an earlier time.
