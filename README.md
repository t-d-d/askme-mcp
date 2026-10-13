# askme.mcp

One place where all of a person's AI agents ask for their input, sorted by rules the person writes in plain English.

> **This is a demo.** Every ask is deleted a month after it is posted. The service runs on a Clerk development instance, which holds at most 100 accounts, so sign-up stops at the hundredth.

The summary of the latest [deploy run](https://github.com/t-d-d/askme-mcp/actions/workflows/deploy.yml) gives the live page's address and the MCP endpoint's.

## What it is

A person who runs several agents gets asked for input by each of them, in each agent's own app. askme gives those agents one place to ask, and gives the person one list, ordered by rules they write themselves.

- An agent calls the MCP server's `ask` tool with a summary, the area of work, a version written to be heard, and up to two links, one to where the person should act and one back to its own session.
- The service sorts the ask against the person's rules into their hashtags and one of three levels.
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

A score counts the asks whose hashtags and level were both right. The core group holds asks from three areas of one person's life. The timing group copies a few core asks with only the time changed, and expects the same level. The hostile group holds asks that try to steer their own sorting, and "Gave in" counts the ones that moved the sort the way they pushed. The scores were saved on 13 October 2026. There is no pass mark.

Most of Haiku's misses rank a saving passed up, such as a cheaper courier or a supplier's price rise, as normal where the eval expects high. Its four timing misses are the same mistake. Each copy got the level its core twin got, so the time did not move the level.

## Agents wrote the code

Coding agents wrote every line of code in this repo, in Claude Code sessions. The owner and Claude wrote the PRD, the decision records and the issues, and the owner approved each one. Each change arrived as a pull request that the owner merged. By 13 October 2026, 133 pull requests had merged.

The agents work to rules kept in the repo, so each session starts from the same instructions.

- [CLAUDE.md](CLAUDE.md) says how to work: one branch per issue, tests first, the gate before every push, and the owner merges.
- [.claude/skills/](.claude/skills/) holds the steps for picking up an issue, checking the constraints, reviewing a branch before it is pushed, and writing a pull request.
- Each decision record lists its checks, and each check is a fitness function named after it. Most run in the gate. A few run after each deploy, every day, or with the eval. `npm run checks` lists any check a record names that has no test. It runs by hand, because a record may name checks that land with a later issue.
- `npm run gate` runs format, lint, types, and the static, unit, integration and browser tests. It runs offline and holds no secrets. A pull request merges only when it passes.

Anything only the owner can do, such as making accounts, setting secrets or connecting a real agent, is an issue labelled `mode: human`. Its closing comment records the result.

## Setup

### On a laptop

You need Node.js 22.18 or later (see [.node-version](.node-version)) and Docker. The integration tests run DynamoDB Local in Docker.

```
npm ci
npx playwright install chromium
npm run gate
```

`npm run eval` runs the eval set against the real model. On a laptop it reads the eval key from `OPENROUTER_API_KEY`. In a Claude cloud session the key is a network secret on the environment, and the command sends none of its own.

### Accounts and settings

These are made once, by hand. The repo refers to each by the name given here, and holds no values.

1. **AWS.** Use an AWS account that holds askme and nothing else, in `us-east-1`. CloudWatch's billing metric and CloudFront's certificates exist only there. Switch on the account's billing alerts, or AWS publishes no billing metric and the spend alarm never fires ([ADR 17](docs/adr/0017-spend-reads-the-bill.md)). A new account may allow only 10 concurrent Lambda executions where AWS's default is 1,000, so ask AWS to raise it.
2. **Parameters.** In Parameter Store, Standard tier, in `us-east-1`:
   - `/askme/alerts/email`, a String, for the address alerts go to.
   - `/askme/alerts/monthly-spend`, a String, for the monthly spend in US dollars that sets off the spend alarm.
   - `/askme/openrouter/api-key`, a SecureString, for the service's model key, which has a spending limit.
3. **The deploy role.** Apply [infra/github-oidc.cfn.yml](infra/github-oidc.cfn.yml) once by hand, as the stack `askme` in `us-east-1`, with the capability `CAPABILITY_NAMED_IAM`. Give it the parameters `GitHubOwnerId` and `GitHubRepoId`, the numeric ids any Actions run shows as `github.repository_owner_id` and `github.repository_id`. It makes GitHub's OIDC provider and the role `askme-github-deploy`, which only a job on main can assume. Each deploy applies it again after that.
4. **GitHub.** Set the repo variables `AWS_DEPLOY_ROLE_ARN`, `AWS_REGION`, `CLERK_PUBLISHABLE_KEY` and `CLERK_ISSUER`, and the repo secret `SERVERLESS_ACCESS_KEY`. Give main a ruleset that requires a pull request and the `gate` check. A daily conformance check reads the ruleset back.
5. **Clerk.** Make a development instance, and set it up as the next section says.
6. **OpenRouter.** Two keys in a workspace of askme's own: the service's key above, and an eval key with a small limit. In a Claude cloud environment, add the eval key as a network secret for `openrouter.ai`, with the header `Authorization` and the prefix `Bearer`.
7. **The first deploy.** Merge to main. The deploy run's summary gives both addresses. Then confirm the alert email, as below.

### Clerk dashboard settings

These are under Configure, then Developers, then OAuth applications.

| Tab | Setting | Value |
| --- | --- | --- |
| Settings | Publish CIMD support | On, with "Allow any client" |
| Settings | Publish DCR support | On |
| Settings | Require PKCE | On, Clerk's default |
| Settings | Access token format | JWT access tokens, Clerk's default |
| Settings | Include Audience | Off, Clerk's default |
| Scopes | Custom scope | `asks:create`, published in discovery |

Under User & authentication, people sign in with email, Google or GitHub. A development instance uses Clerk's shared Google and GitHub credentials. A production instance needs askme's own.

The live check after each deploy signs up its one test account the first time it runs. For that, set Clerk's access mode to Open and turn test mode on.

### Confirming the alert email

The first deploy makes the alert topic, and AWS emails a confirmation link to the address in `/askme/alerts/email`, from `no-reply@sns.amazonaws.com`. No alarm reaches anyone until the link is clicked. It lasts three days. If it runs out, open SNS in `us-east-1`, then Topics, `askme-alerts`, Subscriptions, select the pending subscription and choose Request confirmation.

To check that an alarm reaches you, run this in CloudShell in `us-east-1`:

```
aws cloudwatch set-alarm-state \
  --alarm-name askme-error-lines \
  --state-value ALARM \
  --state-reason "Checking the alert email arrives"
```

An email titled `ALARM: "askme-error-lines" in US East (N. Virginia)` arrives. The command changes only the alarm's state, and the alarm returns to OK at its next one-minute check without sending another email. Use `askme-error-lines` for this. `askme-spend` checks only every six hours, so it would stay in ALARM for hours.

### Restoring the table

The table keeps point-in-time recovery for 35 days. It stays when the stack is deleted or would replace it, and it has deletion protection. A restore makes a new table and leaves the live one alone, so restoring is two steps: restore a copy, then copy its items back into the live table. Run this in CloudShell in `us-east-1`, with the time to go back to in UTC:

```
LIVE=$(aws cloudformation describe-stack-resource --stack-name askme-prod \
  --logical-resource-id Table \
  --query StackResourceDetail.PhysicalResourceId --output text)
aws dynamodb restore-table-to-point-in-time \
  --source-table-name "$LIVE" --target-table-name askme-restored \
  --restore-date-time 2026-01-31T12:00:00Z
aws dynamodb wait table-exists --table-name askme-restored
aws dynamodb scan --table-name askme-restored --query Items --output json \
  | jq -c '.[]' | while read -r item; do
      aws dynamodb put-item --table-name "$LIVE" --item "$item"
    done
aws dynamodb delete-table --table-name askme-restored
```

Each copied item replaces the live item with the same key, and items made since that time stay. If the stack was deleted and deployed again, the old table is still there under its old name: copy from it in the same way, with its name in place of `askme-restored`, and keep it until the copy is checked.

## Checklist for connecting a real agent

No test can connect a real agent, so the owner runs this checklist by hand after a deploy that changes sign-in or the MCP server. The Connect your agents screen gives the steps for Claude and Cursor.

Connect each agent:

- **Claude** (the app, and Claude cloud sessions). Add a custom connector, paste the server address from the Connect screen, and approve askme when Claude asks you to sign in.
- **Claude Code on its own.** Run `claude mcp add --transport http --scope user askme <MCP endpoint>`, then choose Authenticate under `/mcp`.
- **Cursor.** On the computer where Cursor is installed, open the Connect screen and click "Add askme to Cursor". Cursor offers to add a server named askme. Sign in to approve it.

Then, for each agent:

- [ ] The agent lists two tools, `ask` and `resolve`, and no others.
- [ ] It posts an ask, and the card appears on the page within a few seconds, on a phone.
- [ ] The card's main button opens the agent's session. A card with no link has no main button, and tapping it opens the ask's detail.
- [ ] You reply in the session, the agent resolves the ask, and the card clears.

On 12 October 2026 the whole checklist passed for a Claude cloud session and a local Cursor agent. On 11 October, Claude Code on a laptop and in the Claude desktop app connected and called `ask`.

## What is untested

- **Real agents connecting.** The owner runs the checklist above by hand. A change can pass every test and still break a real client.
- **A Cursor cloud agent's session link.** Cursor cloud agents need a paid plan, which the owner does not have. The demo works without it, because a card with no link opens its detail.
- **Speech on a phone.** Listen uses the browser's own speech. No test hears it.
- **Whether the page matches the design.** Each change to the page is compared with the mockup by eye at phone width. No test sees it.
- **Sorting quality.** The eval scores above have no pass mark, and the eval runs on demand, outside the gate. The model may sort the same ask differently from one call to the next.
- **The alert email and billing.** Confirming the subscription and switching on billing alerts are done by hand. No check can see either, or that the AWS account holds nothing else.
- **Main's ruleset.** It lives in GitHub's settings, which no pull request can see. The daily conformance check reads it, so a change shows up the next day.
- **Load.** Nothing has been tested with more than a handful of people, and the Lambda limit in step 1 caps how many requests run at once.
- **A Clerk production instance.** askme has only run on a development instance.

## Trade-offs

- **The page polls.** It asks for changes every few seconds while it is open, and not at all while hidden. A new ask can take a few seconds to show, and nothing runs while nobody looks ([ADR 1](docs/adr/0001-polling.md)).
- **Agents read nothing.** An agent never learns whether its ask was opened or dismissed, and cannot list its own asks. It must keep the ids it was given, and always asks in its own session as well ([ADR 2](docs/adr/0002-agents-write-only.md), [ADR 11](docs/adr/0011-error-contract.md)).
- **Rules are plain English, read by a model.** There is no compile step, and no fixed rule sits behind a sort. The eval set and the reason on each card are the checks on it.
- **One environment.** There is no staging, so nothing deployed is tested before it merges. A live check signs in on the deployed page after each deploy ([ADR 4](docs/adr/0004-repo-and-delivery.md), [ADR 16](docs/adr/0016-live-sign-in.md)).
- **A Clerk development instance.** It needs no domain, but it holds 100 accounts and uses Clerk's shared Google and GitHub credentials. DCR is on, though Clerk marks it deprecated, because MCP clients still use it. That opens a public registration endpoint and puts Clerk's consent screen on every agent sign-in. Clerk's tokens carry no audience, so the service does not check one. The instance issues tokens for askme alone ([ADR 6](docs/adr/0006-identity.md)).
- **The deploy role is an administrator.** The AWS account holds only askme, and a role that must create roles for its functions could make itself an administrator anyway. The guards are that only main can assume it, only the owner merges, and every merge needs the gate.
- **One table, with no index and no scan.** Every read is one account's. A question across accounts needs a new decision ([ADR 13](docs/adr/0013-table-design.md)).
- **The sort queue costs a little when idle.** Lambda polls the SQS queue whether or not it holds jobs, and AWS bills those requests. Everything else scales to zero ([ADR 22](docs/adr/0022-sort-queue.md)).
- **Daily caps.** An account that reaches 2,000 model calls in a day stops being sorted until the next UTC day, and its asks that were left out wait until the rules are saved again ([ADR 21](docs/adr/0021-model-call-cap.md)).
