# askme.mcp: PRD for version 1

## Summary

askme is one place where all of a person's AI agents ask for their input, sorted by rules the person writes in plain English.

**Problem.** People now run several agents at once, across unrelated parts of their work and life, and across more than one vendor. Each agent asks for input in its own way and in its own app. Nothing brings those asks together or ranks them, and the person has no say over what reaches them or when.

**User.** One person running several agents. It is a personal tool, not a team approvals system.

**What it is.** An MCP server that any agent can call to post an ask, a small service that sorts each ask against the user's rules, and a mobile-first web page that shows what needs them now.

**Why it matters.** Agents are cheap and a person's attention is not. askme lets the person set the terms on which agents get that attention. That is one answer to how people avoid burning out when they work with agents.

## How it works

1. **The user writes rules.** In one box on the page, in plain English: the hashtags they want, what should rank high or low, and any hours a hashtag should be limited to.
2. **The service reads the rules once.** On save, a model call lists the hashtags and their time windows and shows them back. Nothing else is compiled.
3. **An agent posts an ask.** It calls the MCP server with a short summary, the broad area the ask belongs to, a version written to be listened to, and up to two optional links: one to where the user should act, such as a pull request or a ticket, and one back to its session. The service stores the ask and returns an id.
4. **The service sorts it.** A model call reads the rules and the ask. It picks hashtags from the user's own set, one of three priority levels, and a one-line reason. If the call fails, the ask is kept and shown as unsorted.
5. **The user sees it.** Cards are ordered by priority, then by how long they have waited. An ask with a hashtag outside its hours is held back, and one line says how many are held and lets the user show them.
6. **The user listens or reads.** A card can be read aloud.
7. **The user acts where the work is.** Tapping a card opens the place to act: a pull request, say, or the agent's own session, where the user replies with full context. askme does not carry the answer back.
8. **The ask clears.** The agent resolves it as soon as it is unblocked, or the user swipes it away.

The split behind this: the sending agent describes its ask, but it does not judge how much the ask matters or where it belongs. That judgement is made on the user's side, against rules that agents never see.

## In scope for version 1

Version 1 is a personal service with sign-up, in three parts: an MCP server, a small serverless back end, and a mobile-first web page.

### Accounts and connection

- Sign-up and sign-in go through a hosted identity service. Sign-up is open to anyone, with a daily cap on asks per account to limit abuse.
- Agents connect by OAuth through the same service. There are no keys to copy.
- Every ask and rule belongs to one account, and each account is one person.
- The page has a "Connect your agents" section: the server address, steps for Claude, and a one-click button for Cursor.
- The service is labelled as a demo. Every ask is deleted one month after it is posted. While it runs on a Clerk development instance it is limited to 100 accounts.

### Rules

- One text box holds the rules in plain English.
- On save, the service lists the hashtags and any time windows it read from the rules, and shows them back.
- Saving re-sorts every open ask. Cards keep their old hashtags until that finishes.
- Time windows use the user's time zone, taken from the browser on save.
- A new account starts with example rules in the box. With the box empty there are no hashtags, and every ask appears in Everything.
- Only the signed-in user can read or change the rules.

### MCP server

- Two tools and nothing else: **ask** and **resolve**.
- **ask** posts an ask and returns its id. It can carry the id of an earlier ask, which it then replaces. Delivery is at least once: an ask identical to one posted on the same account in the last ten minutes returns the first one's id, so a retry does not make a second card. See [ADR 3](docs/adr/0003-idempotency.md).
- **resolve** closes an ask by id.
- The server sends its own instructions to each client, and the essentials are repeated in the tool descriptions, because not every client passes server instructions on.
- Those instructions say four things. Post whenever work stops to wait for the person, since a cleared ask costs them nothing. A session may hold several open asks. Resolve as soon as the wait is over, before doing anything else, whether the person replied or the awaited event happened, such as a pull request being merged. If a call times out, send the same ask again unchanged.
- Agents get no tool that reads anything: not the rules, the hashtags, other asks, or their own asks. See [ADR 2](docs/adr/0002-agents-write-only.md). A refusal carries a code that tells the agent whether to retry. See [ADR 11](docs/adr/0011-error-contract.md).

### The ask

| Field | Set by | Notes |
| --- | --- | --- |
| Summary | Sending agent | One or two lines for the card. Hard character limit, rejected if longer. |
| Area | Sending agent | Required. One short line naming the project or part of life the ask belongs to. Broad, not the task in hand. It helps sorting and is not shown. |
| Spoken detail | Sending agent | Plain sentences written to be heard. No markdown, code, file paths or raw URLs. About a minute of speech at most. |
| Action link | Sending agent, optional | Where the user takes the action when that is not the session, such as a pull request or a ticket. Must be https. |
| Session link | Sending agent, optional | Back to the agent's session, for when the user needs to reply to the agent. Must be https. |
| Replaces | Sending agent, optional | The id of an earlier ask that this one takes over from. |
| Hashtags | Model | Only from the user's own set. An ask can carry several, or none. They are shown in the order the hashtags appear in the rules, and the first sets the colour of the ask's main button. |
| Priority | Model | Three levels, judged on what is stalled. Used for order only and not shown. |
| Reason | Model | One line on why the ask was sorted this way. |
| State | Service | Open, opened or closed. A closed ask records how it ended: resolved by the agent, dismissed by the user, or replaced. |

### Back end

- Serverless, with no always-on compute. The page polls for new asks.
- An ask is never rejected or lost because sorting failed. It shows as unsorted and is retried.
- One model call per ask does the sorting and returns a validated structure. One smaller call runs when rules are saved.
- Time windows are applied in code when the page loads, not by the model.
- When an ask is replaced, both versions stay in the store. A retried ask is matched by its content and is not stored twice.

### Web page

- Mobile first and responsive, so it also works on desktop.
- An Everything tab, plus one tab per hashtag.
- An ask is held back if any of its hashtags is outside its hours. When asks are held, a line under the tabs says how many, with a control to show them. With nothing held, the line is not there. This works the same on every tab.
- Order is priority level, then longest waiting first. Opened cards sink below unopened ones at the same level. The first ask is shown large, and the rest as a compact list below it.
- A card shows the summary, its hashtags in colour, and its age.
- Tapping a card opens its action link. With no action link it opens the session link, and with neither it opens the detail. A card with both has a second control for the session. Each link shows the name of the site it leads to. The main button says what the link is when askme recognises it, such as a pull request, and otherwise names the site. Following a link marks the card as opened and does not clear it.
- A Listen button reads the spoken detail aloud, using the browser's built-in speech. A disclosure shows the same text and the reason.
- Swiping dismisses a card, with a brief undo.
- New asks appear without a manual refresh. When nothing is waiting, the page says "All clear" and that the agents are getting on with it. A new account sees how to connect an agent instead.
- A "simulate an agent" control posts sample asks across three areas, different on each press, so sorting can be seen without connecting an agent.

### Stack

| Part | Choice | Recorded in |
| --- | --- | --- |
| Hosting | AWS: the page on S3 and CloudFront, the service on Lambda | [ADR 5](docs/adr/0005-hosting.md) |
| Store | DynamoDB, on demand, as one table keyed by account ([ADR 13](docs/adr/0013-table-design.md)) | [ADR 5](docs/adr/0005-hosting.md) |
| Front end | React and TypeScript, built with Vite, as a single-page app | [ADR 5](docs/adr/0005-hosting.md) |
| Polling | TanStack Query | [ADR 1](docs/adr/0001-polling.md), for the rule it follows |
| Identity | Clerk, for sign-in and for agent OAuth | [ADR 6](docs/adr/0006-identity.md) |
| MCP server | The official TypeScript SDK, run stateless | [ADR 5](docs/adr/0005-hosting.md) |
| Model access | OpenRouter, so several models sit behind one key. The model that sorts is chosen with the eval set. | This PRD |
| Repo and delivery | GitHub, GitHub Actions on standard runners, and the Serverless Framework | [ADR 4](docs/adr/0004-repo-and-delivery.md) and [ADR 5](docs/adr/0005-hosting.md) |
| Logs and alerts | CloudWatch: structured logs with no user content, four alarms, alerts by email | [ADR 7](docs/adr/0007-logging.md) and [ADR 8](docs/adr/0008-alerting.md) |
| Tests | Vitest, Playwright as a library, and a local DynamoDB, in six tiers | [ADR 9](docs/adr/0009-test-pyramid.md) and [ADR 15](docs/adr/0015-conformance-tier.md) |
| Types and lint | TypeScript with every strictness option on, ESLint with type-aware rules, Zod at every boundary, Prettier | [ADR 10](docs/adr/0010-types-and-lint.md) |
| Design and styling | The design language in [docs/design.md](docs/design.md), written as plain CSS from one set of tokens | [ADR 14](docs/adr/0014-styling.md) |

## Out of scope for version 1

Each of these was considered and left out on purpose.

- **Answering in the app.** No approve or reject buttons and no reply box. The user acts in the agent's own session, or wherever the work is.
- **A path back to the agent.** The service never reaches an agent. Nothing tells an agent that its ask was dismissed, because a dismissal is not an answer.
- **Real notifications.** No push and no live connection. Holding asks until their hours stands in for them.
- **Voice input.** Listening only.
- **Keys and a public API.** MCP with OAuth is the only way in for agents.
- **Setting rules through an agent.** Rules are written on the page.
- **Agents choosing hashtags.** Agents never see the user's hashtags or rules. See the decisions table for why.
- **The service rewriting an agent's text.** The sender writes the summary and the spoken detail. The service's model only sorts.
- **Snooze.** Time windows and the opened state cover putting an ask off for now.
- **Stacking cards by session.** The service has no session identity. Replacing an ask by id covers the common case.
- **Free-form layout.** Tabs over one card list. No user-designed panes or dashboards.
- **Status updates and FYI messages.** Only asks that need the user's input.
- **Teams.** One person per account. No shared queues or roles.
- **Native apps and widgets.** A web page only.

## Roadmap

In rough order of value. None of this is built in version 1.

1. **Real approvals.** Answer in the app, with the answer returned to the agent. MCP allows a path back in some cases. This needs care over what exactly is being approved.
2. **Pings.** Push notifications on the phone, driven by the same rules, so the user decides what interrupts them and at what time of day.
3. **Widgets.** A phone and desktop widget showing the top of the list with held asks left out.
4. **Rules by conversation.** A second, admin permission on the MCP server, held only by the user, so they can set rules by talking to an agent. Other agents still cannot see or change them.
5. **Hands-free use.** One button that reads the whole list aloud in order, and answering by voice. A further permission would let a voice assistant read the queue and answer for the user.
6. **Better voices.** Replace the browser's speech with a higher quality text-to-speech service.
7. **A skill alongside the MCP server.** Packaged guidance so agents in different environments know when to ask and how to write a good ask.
8. **A shared list of areas.** A short list of broad areas the user chooses to share with agents, to steer what they put in the area field. It is separate from the hashtags, which stay private and can change at any time. Whether this is needed is an open question.
9. **Better ranking.** The sorting model sees little of the work behind an ask. How much ranking is worth is an open question, since the aim is a short list and not a detailed priority queue.
10. **Automatic replacement by link.** A new ask with the same link as an open one could replace it. This is an open question, because one session can rightly hold several asks.
11. **Stacking cards by session.** Group cards the way a phone groups notifications.
12. **More agent environments.** Prove the same server from more vendors' agents.
13. **Status updates.** A separate, lower-priority stream for progress reports that need no answer.
14. **A picture for the moment.** A generated picture on the all-clear screen.

## Demo and checks

Version 1 is done when the recorded demo below works end to end on the deployed site.

**Recorded demo, two to three minutes, on a phone**

1. The user types rules in plain English and the hashtags appear.
2. A Claude cloud session stops to wait and posts an ask. The card appears under the right hashtag.
3. The user taps Listen, then taps the card and lands in that session in the Claude app. They answer, the agent resolves the ask, and the card clears.
4. An agent opens a pull request and posts an ask with an action link. The user taps the card, lands in GitHub and merges. The agent is notified, resolves the ask, and the card clears with no reply typed.
5. An agent in Cursor posts an ask, and its card lands in the same list.
6. The user changes a rule and the list re-sorts.

**Live site.** Anyone can sign up, find example rules already in place, and use the "simulate an agent" control to watch sample asks being sorted.

**Eval set.** About 30 hand-written asks across three areas, each with the hashtags and priority level expected. One further group is hostile: asks that try to steer the sorting. It is scored on its own. See [ADR 12](docs/adr/0012-untrusted-ask-text.md). It runs on demand, not on every commit. The scores are reported in the README, with no pass mark.

**Other tests.** Schema validation rejects bad asks. A model failure does not lose an ask. Time windows behave at their boundaries, and a restriction wins when an ask's hashtags disagree. An agent cannot read rules, hashtags or other asks.

**README.** Links to the film of the demo, and covers the overview, the stack, how the model is used and why that model, setup, the real build time and the fact that agents wrote the code, what is untested, the demo-data notice, and the trade-offs in this document.

## Decisions and reasons

The product choices that shape version 1, each with the reason it was made. Technical decisions are recorded as ADRs in [docs/adr](docs/adr/README.md).

| Decision | Reason |
| --- | --- |
| Agents describe an ask, and the user's side judges it | Every agent thinks its own ask is urgent. |
| Agents never see the hashtags or rules | Privacy: an agent working on one part of a person's life should not learn what the other parts are. The service also has to sort on its own anyway, because rules change after an ask is posted and the session that sent it may be gone. How this is enforced is recorded as [ADR 2](docs/adr/0002-agents-write-only.md). |
| Rules stay as plain English | There is no compile step and no dependence on a connected agent. The cost is that no fixed rule sits behind each sorting decision, which is why there is an eval set. |
| Sorting is done by a model and is not deterministic. Time windows are deterministic and run in code | Models are unreliable at date arithmetic, and a single timestamp cannot express recurring hours. |
| A restriction wins when hashtags disagree | Holding too much back is undone by showing the held asks. Work showing up out of hours defeats the feature. |
| The user acts where the work is, not in askme | The agent's session or the pull request has the full context, and nothing is approved through a third party. |
| Agents err towards posting | A cleared ask costs the user nothing, and they may have stepped away. |
| An ask is never rejected, lost or held up by sorting | An agent's call should not wait on a model or fail with it. How that is built is an implementation detail. |
| OAuth through a hosted identity service | Claude's hosted apps connect to a custom server by OAuth, not by a pasted key. Building an OAuth server is out of proportion for version 1. Recorded as [ADR 6](docs/adr/0006-identity.md). |
| Polling, not live updates | Recorded as [ADR 1](docs/adr/0001-polling.md). |
| The area field is required | An agent writing from inside its task leaves out which project it is working on. |
| Three priority levels, not shown | The aim is a short list, not a detailed priority queue. |

## Open questions and risks

**Open questions**

- [x] Stack. Decided: see the Stack table and [ADRs 4 to 6](docs/adr/README.md).
- [ ] Which model does the sorting? It is chosen with the eval set, through OpenRouter.
- [ ] Does Clerk work from Lambda, and does a Claude cloud session connect through it? This is the first test of the build. See [ADR 6](docs/adr/0006-identity.md).
- [ ] A domain for askme. The build starts on a Clerk development instance, which needs none. A domain is needed only if the first test shows a development instance will not do.
- [ ] Does Clerk handle Claude Code's local redirect, which uses a different port each session? Test early in the build.
- [ ] Can a Cursor cloud agent find its own session link? Test during the build. The demo works either way, because a card without a link opens its detail.
- [ ] Do agents reliably resolve their asks? Version 1 records how each ask ended, so this can be measured.
- [ ] How does askme differ from what exists? [gotoHuman](https://glama.ai/mcp/servers/@gotohuman/gotohuman-mcp-server/tree) and [Impri](https://mcp.so/servers/impri) both offer approval inboxes for agents over MCP, and Impri approves inside its inbox. askme's claim is the human side: one person's attention across vendors and areas, under their own rules. Neither has been used hands-on.
- [x] Can an agent find its own session link? Yes for a Claude cloud session. The link is available in its environment, and on 9 Oct it opened the right conversation in a desktop browser and in the mobile app. This relies on an undocumented convention.

**Risks**

- **Scope.** If version 1 needs trimming, time windows and holding asks back go first. The Listen button on each card stays.
- **Setup, not code.** Accounts and configuration are likely to take the most time: the identity service, hosting, and connecting two agent environments.
- **Clearing up.** Posting freely is only harmless if agents resolve their asks. If they do not, the list grows. An ask whose action happens elsewhere, such as a pull request, is resolved only if the agent's environment tells it the action happened. Claude cloud sessions are notified of activity on pull requests they follow. Where an agent is not told, the card relies on the user's swipe.
- **Sorting quality.** The model sees one short ask and the rules. The eval set and the visible reason are the checks on it.
- **Speech in the browser.** It needs a tap to start on phones, and voice quality varies by device.
- **Name.** askme.mcp is a working name.
