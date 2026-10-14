# askme.mcp

One place where all of a person's AI agents ask for their input, sorted by rules the person writes in plain English.

Built by [Thomas Dickinson](https://github.com/t-d-d) with Claude.

<!-- Demo video goes here. -->

> **This is a fully functional demo.** Every ask is deleted a month after it is posted. [Demo limits](#demo-limits) says how it differs from a production service.

## What it is

People now run several AI agents at once, at work and at home, and each one asks for their input in its own app, at any hour. askme gives every agent one place to ask, and puts the person in charge of that channel. Any agent that can connect to an MCP server can post to it. The person's rules, written in plain English, decide how each ask is sorted, what shows first and what waits for its hours. Every area of their life ends up in one list on their phone.

- An agent calls the `ask` tool with a summary, the area of work, a version written to be heard, and up to two links: where the person should act, and the agent's own session.
- The service sorts the ask against the person's rules into their hashtags and one of three levels: high, normal or low.
- The rules can limit a hashtag to certain hours, such as "#work only on weekdays, 8am to 6pm". An ask outside its hashtag's hours is held back until then. Each hashtag has its own tab.
- The page shows the list on a phone, with the first ask shown large. A card can be read aloud, and its main button opens the place to act, such as a pull request or the agent's session.
- The agent calls `resolve` when its wait is over, and the card clears. The person can also swipe it away.

The [PRD](PRD.md), the product requirements document, says what version 1 does, what it leaves out and what comes next. [docs/design.md](docs/design.md) shows every screen.

## Try it

The page is live at https://d1dqzjjllemayb.cloudfront.net. To try it without an agent, sign up and press Send sample asks. Agents connect to the MCP endpoint at `https://fx0y26c8v0.execute-api.us-east-1.amazonaws.com/mcp`, and the page's Connect your agents screen gives the steps. In Claude Code, run this, then choose Authenticate under `/mcp`:

```
claude mcp add --transport http --scope user askme https://fx0y26c8v0.execute-api.us-east-1.amazonaws.com/mcp
```

In Cursor, use this button, then sign in when Cursor asks:

[![Add askme to Cursor](https://img.shields.io/badge/Add_askme_to-Cursor-000000)](https://cursor.com/en/install-mcp?name=askme&config=eyJ1cmwiOiJodHRwczovL2Z4MHkyNmM4djAuZXhlY3V0ZS1hcGkudXMtZWFzdC0xLmFtYXpvbmF3cy5jb20vbWNwIn0%3D)

## What comes next

Version 1 shows asks only while the page is open, and sends no notifications. In rough order of value, the [roadmap](PRD.md#roadmap) adds:

- **Real approvals.** Answer in the app, with the answer returned to the agent.
- **Pings.** Push notifications on the phone, driven by the same rules, so the person decides what interrupts them and when.
- **Widgets.** The top of the list on a phone or desktop widget.
- **Rules by conversation.** Set rules by talking to an agent, with a permission only the person holds.
- **Hands-free use.** The whole list read aloud in order, and answers by voice.
- **A skill alongside the MCP server.** Guidance so agents know when to ask and how to write a good ask.

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

Each choice that is hard to reverse has an architectural decision record (ADR) in [docs/adr/](docs/adr/README.md), and the rules they put in force are in [docs/constraints/](docs/constraints/README.md).

## How the model is used

The service makes two kinds of model call. Both go through OpenRouter, ask for a reply that fits a JSON Schema, turn reasoning off, and use only providers that keep no prompts.

1. **Reading the rules.** When the person saves their rules, one call lists the hashtags and any hours each one is limited to. The page shows them back.
2. **Sorting an ask.** One call per ask reads the rules and the ask, and replies with hashtags from the person's own list, one of three levels, and a reason of at most 140 characters.

The sorting call treats the ask as hostile text ([ADR 12](docs/adr/0012-untrusted-ask-text.md)). It declares no tools, and the agent's fields sit in one delimited section with any delimiter inside them escaped. A reply that fails the schema is thrown away and the ask stays unsorted. Nothing the model says goes back to an agent, and the page shows the reason as plain text.

Posting never waits on the model. The service stores the ask, puts a sort job on the queue and answers the agent, and the queue retries a failed sort ([ADR 22](docs/adr/0022-sort-queue.md)). The service applies hours, and the time an ask stops mattering, in code, because models are unreliable at date arithmetic.

### Why Claude Haiku 5.5

The eval set holds 48 asks: 32 core, 4 timing and 12 hostile. `npm run eval:candidates` sent each of them to seven cheap, quick models twice, with the service's prompt. Claude Haiku 5.5 scored best over the whole set, so it is the default. Every miss and its reason is in [evals/scores.md](evals/scores.md).

| Model | Core | Timing | Hostile | All | Gave in | No fitting reply | Median reply |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `anthropic/claude-haiku-5.5` | 58/64 (91%) | 4/8 (50%) | 24/24 (100%) | 86/96 (90%) | 0 | 0 | 0.9s |
| `google/gemma-4-31b-it` | 49/64 (77%) | 7/8 (88%) | 24/24 (100%) | 80/96 (83%) | 0 | 0 | 1.4s |
| `xiaomi/mimo-v2.6-flash` | 47/64 (73%) | 6/8 (75%) | 23/24 (96%) | 76/96 (79%) | 0 | 0 | 2.9s |
| `deepseek/deepseek-v4.1-flash` | 45/64 (70%) | 5/8 (63%) | 23/24 (96%) | 73/96 (76%) | 0 | 1 | 0.7s |
| `google/gemini-3.1-flash-lite` | 44/64 (69%) | 7/8 (88%) | 21/24 (88%) | 72/96 (75%) | 0 | 0 | 1.1s |
| `mistralai/mistral-large-4-0` | 52/64 (81%) | 3/8 (38%) | 13/24 (54%) | 68/96 (71%) | 0 | 14 | 1.9s |
| `qwen/qwen3.5-35b-a3b` | 37/64 (58%) | 3/8 (38%) | 13/24 (54%) | 53/96 (55%) | 1 | 0 | 1.0s |

A score counts the asks whose hashtags and level were both right. Core asks come from three areas of one person's life. Timing asks copy a few core asks with only the time changed, and expect the same level. Hostile asks try to steer their own sorting. Gave in counts the hostile asks whose sort did what the ask demanded. No fitting reply counts replies that did not fit the schema. The scores were saved on 13 October 2026, and there is no pass mark.

## Agents wrote the code

Coding agents wrote every line of code in this repo, in Claude Code sessions, over a few days. The owner and Claude wrote the PRD and the decision records, and the owner approved each one. The owner and Claude broke the PRD into issues, and agents raised many more from work they found in passing. By 14 October 2026, 202 pull requests had merged.

Before every push, the agent ran the gate, the repo's offline checks, and a high-effort code review of its branch, and fixed, filed or dismissed each finding. A pull request merges only when the gate passes in CI. The owner reviewed and merged the early pull requests. Once the gate and the reviews had earned enough trust, the owner set agent sessions to land whole trains, runs of linked issues worked in order, refactors among them, and those sessions reviewed and merged each pull request with no person reading it.

Every session starts from the same rules, kept in the repo:

- [CLAUDE.md](CLAUDE.md) says how to work: one branch per issue, tests first, and the gate before every push.
- [.claude/skills/](.claude/skills/) holds the steps for picking up an issue, checking the constraints, reviewing a branch before it is pushed, and writing a pull request.

Each issue describes one change, with a label for its type, such as `type: bug`, and one for its mode. An agent takes a `mode: afk` (away from keyboard) issue, one it can finish without a person, to a pull request that closes it. Anything only the owner can do, such as setting secrets or connecting a real agent, is a `mode: human` issue, and its closing comment records the result.

## How it is tested

`npm run gate` runs format, lint, types, and the static, unit, integration and browser tests. It runs offline, holds no secrets, and is the same command on a laptop and in CI. A test's file name sets its tier, and its tier sets what it may touch ([ADR 9](docs/adr/0009-test-pyramid.md)).

| Tier | What it checks | Runs |
| --- | --- | --- |
| Static | Types, lint, and fitness functions that read the repo's own files | In the gate |
| Unit | Logic in memory, such as time windows, ordering and schemas | In the gate |
| Integration | The API and the MCP tools from end to end, against a local DynamoDB, a fake model and test-key tokens | In the gate |
| Browser | The built page in headless Chromium, with the API faked | In the gate |
| Live | The deployed page, API and MCP endpoint. One check signs in as the one test account, sends sample asks and waits for each to be sorted. | After each deploy |
| Conformance | Setup held outside the repo, such as main's ruleset in GitHub | Every day |

If a deploy fails partway, or its live check fails, the run puts back the last build that passed the live check ([ADR 25](docs/adr/0025-roll-back-to-live-ok.md), [ADR 33](docs/adr/0033-roll-back-a-partial-deploy.md)).

Each decision record names checks for the rules it puts in force, and each check is a test of the same name, called a fitness function. `npm run checks` lists any check that has no test.

`npm run mutate -- <suite>` runs mutation testing with StrykerJS over one of nine suites, by hand. It makes small changes to the code and lists the ones no test catches. The refactoring train ([#225](https://github.com/t-d-d/askme-mcp/issues/225)) ran it before and after each move.

The eval set measures sorting against the real model, on demand. The model may sort the same ask differently from one call to the next.

[docs/testing.md](docs/testing.md) says what stands in for each outside service in the gate, where the real one is checked, and the mutation figures for each refactor.

### Manual checks

- **Real agents connecting.** The owner runs the [checklist for connecting a real agent](docs/agent-checklist.md) after a deploy that changes sign-in or the MCP server. It last passed on 12 October 2026, for a Claude cloud session and a local Cursor agent.
- **Speech on a phone.** Listen uses the browser's own speech, which no test hears. The owner has checked on a phone that a card is read aloud.
- **The page against the design.** Before pushing a change to the page, the coding agent compares it with the mockup at phone width, by eye. The gate checks the design's colours and font sizes, the contrast of the hashtag colours and the tap size of the controls the browser tests measure, but not the layout.
- **The AWS account and the alert email.** While [bootstrapping](docs/bootstrap.md), the owner keeps the AWS account to askme alone, switches on billing alerts and confirms the alert email. A test alarm shows that the email arrives.

## Demo limits

- There is one deploy environment, with no staging. A green merge to main deploys straight to the live site.
- Clerk runs as a development instance. It holds at most 100 accounts, so sign-up stops at the hundredth, and it signs people in with Clerk's shared Google and GitHub credentials.
- Limits are per account: 100 asks and 2,000 model calls a day, and per-minute limits on polling, posting and saving rules. None of these limits one address, or a request without a valid token. Across all accounts, the whole API takes about 50 requests a second, with bursts of 100, and refuses the rest ([ADR 31](docs/adr/0031-api-throttle.md), [ADR 35](docs/adr/0035-one-throttle-allowance.md)), so a flood on any route shuts every account out while it lasts. 100 accounts could make 200,000 model calls a day, and the model key's own spending limit is what stops them.
- There is no web application firewall. AWS WAF cannot attach to this kind of API, and agents call API Gateway's own address, which bypasses CloudFront. A firewall on CloudFront would need a custom domain first. Until then, AWS's standard DDoS protection and the rate limit slow a flood, and the spend alarm and API Gateway's request counts show one.
- There is no privacy notice, no terms of service, and no way for a person to delete their account or their data.
- askme has run with no more than a handful of people, and a new AWS account may run only 10 Lambda functions at once ([bootstrapping](docs/bootstrap.md), step 1).

## Design choices

- **The page polls.** It asks for changes every few seconds while it is open, and not at all while hidden. This keeps the service fully serverless, with no open connection and nothing running while nobody looks. A new ask can take a few seconds to show ([ADR 1](docs/adr/0001-polling.md)).
- **Agents can post and resolve asks, and read nothing.** They never see the rules, the hashtags or even their own asks. An agent keeps the ids it was given, and always asks in its own session as well ([ADR 2](docs/adr/0002-agents-write-only.md), [ADR 11](docs/adr/0011-error-contract.md)).
- **Rules are plain English, read by a model.** There is no compile step, and no fixed rule sits behind a sort. The eval set and the reason on each card are the checks on it.
- **Clerk handles sign-in and agent OAuth.** Clerk's tokens carry no audience, so the service does not check one. The instance issues tokens for askme alone ([ADR 6](docs/adr/0006-identity.md)).
- **The deploy role is an administrator.** The AWS account holds only askme, and a role that must create roles for its functions could make itself an administrator anyway. The guards are that only main can assume it and every merge needs the gate.
- **One table, with no index and no scan.** Every read is one account's. A question across accounts needs a new decision ([ADR 13](docs/adr/0013-table-design.md)).
- **Daily caps.** Every model call shares one key, so an account that reaches 2,000 calls in a day stops being sorted until the next UTC day. That stops one scripted account spending the key's limit for everyone ([ADR 21](docs/adr/0021-model-call-cap.md)).
- **Everything scales to zero but the sort queue.** Lambda polls the SQS queue whether or not it holds jobs, and AWS bills those requests ([ADR 22](docs/adr/0022-sort-queue.md)).

## Lessons learned

- **Keep decisions and their amendments in issues, and only the constraints in the repo.** The repo holds 35 decision records, about 42,900 words, against 8,100 lines of application code. A merged record cannot be edited, so each amendment is a new record. Fifteen of the 35 amend an earlier one, and a reader follows the chain to learn what holds. That history belongs in issues. The repo needs only the constraint files, about 7,800 words, which are what an agent reads before a change.
- **Decide whether follow-up work is worth doing before anyone builds it.** Any work found in passing became an issue, about 60 of the 211. Too many were raised, and some were turned down only at pull request review, after the work was done. Next time each would be weighed when it is raised, its value against the complexity it adds, and closed then if it does not pay its way.
- **Catch an agent's bad habits early, and turn each into a rule.** The agents made most design choices well unprompted, but a few habits went wrong and spread unnoticed. Logic went into the page's components, where unit tests caught none of its mutants (0 of 101, 0 of 88 and 0 of 100) until the refactoring train moved it out. Five test files each wrote their own fake of the store until one helper replaced them ([#308](https://github.com/t-d-d/askme-mcp/pull/308)). A long list of design rules up front would not have helped. Faster feedback would: mutation testing from the first days, and scheduled reviews of the whole code base outside the merge cycle. Either finds a pattern while it is in one or two places, when a rule costs little.
- **Set the repo up for agents working in parallel.** Many agents worked at once against one main branch. 202 pull requests merged, and branches caught up with main 176 times. Catching up is normal. What cost time was the files every change touches, such as the README and the decision record index, which conflicted again and again, and two branches once took the same record number. Shared files should be few, and laid out so that git can merge them by itself: one file per entry instead of one shared table, numbers taken from the issue or given at merge, and indexes built by a script.

## Setup

[docs/setup.md](docs/setup.md) says how to run the gate and the eval set on a laptop. [docs/bootstrap.md](docs/bootstrap.md) lists the accounts and settings a new deployment needs. [docs/restore.md](docs/restore.md) says how to restore the table to an earlier time.

## Licence

[Apache 2.0](LICENSE).
