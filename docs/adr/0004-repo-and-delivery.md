# ADR 4: One repo, a protected main, and one environment

Decided on 9 October 2026: everything lives in one repo on GitHub, main is protected and changes reach it only by pull request, and GitHub Actions on standard runners runs the gate and deploys a green merge to the single environment.

Parent PRD: [PRD](../../PRD.md)

## Constraint-set delta

Adds [`docs/constraints/repo-and-delivery.md`](../constraints/repo-and-delivery.md).

## Context

- **Agents write the code.** A change needs a place where automated checks run before it reaches the branch that deploys. A pull request is that place.
- **One person owns the product.** There is nobody to hand a review to, so the checks have to carry the weight a second reviewer would.
- **It is a demo.** Every extra environment doubles the setup for sign-in, OAuth and agent connections, and setup time is the scarcest thing.
- **The repo is part of the submission.** Its history should show how each change was made and checked.

## Decision

There is one repo, one protected branch and one environment, and only one way for a change to go live.

**The repo**

1. All code, the deployment definition and the docs live in one repo, hosted on GitHub.
2. The layout below is provisional until the stack is chosen, because a framework may impose its own.

```
PRD.md      the product requirements
CLAUDE.md   how agents work in this repo
web/        the page
service/    the API and the MCP server
infra/      the deployment definition
evals/      the eval set, run on demand
docs/       adr/, constraints/ and the design
.github/    workflows and the pull request template
.claude/    skills and hooks for the agents that write the code
```

3. Decision records are files in `docs/adr/`, one per decision, numbered in order. They are files and not issues, so that anyone reading the repo finds them, and a new decision arrives by pull request like any other change. The rules in force live in `docs/constraints/`, one file per topic.

**The branch**

4. Nobody pushes to main directly. Every change is a pull request into main.
5. One command runs the whole gate, and it is the same command locally and in CI: lint, types, tests, browser tests and fitness functions. CI and deploys run on GitHub Actions, using standard GitHub-hosted runners only.
6. A pull request merges only when that gate is green. The owner's merge is the one human approval. No separate review is required.

**The environment**

7. There is one environment, and it is the live demo. There is no staging and no preview per pull request.
8. A green merge to main deploys automatically. Nothing else deploys, and nobody deploys from a laptop.
9. CI reaches the cloud with short-lived credentials and holds no cloud keys. Secrets the running service needs, such as the model key, live in the cloud's secret store and never in the repo. The one long-lived secret CI holds is the Serverless Framework's access key, kept as a GitHub repo secret. It is a licence credential, not a cloud key.
10. A bad change is rolled back by reverting its pull request.
11. The eval set is not part of the gate. It costs money and is not deterministic, so it runs on demand.

## Alternatives considered

1. **Push straight to main.** This is the fastest way for one person to work. Rejected: agents write the code, and main deploys straight to the only environment, so a change would be live before anything had checked it. Pull requests also leave the history a reviewer can read.
2. **A second environment, or a preview for each pull request.** A risky change could be tried before it is live. Rejected: each environment needs its own sign-in setup, OAuth redirect addresses and agent connections. That doubles the part of the build expected to take longest, for a demo with one owner. An implementer is likely to suggest this, so it becomes a "Do not" in the constraint file.
3. **Deploy by hand from a laptop.** Rejected: it cannot be repeated, it puts cloud credentials on a laptop, and what is live drifts from what is on main.
4. **Separate repos for the page and the service.** Rejected: most changes touch both, and one repo gives one gate and one history.
5. **Self-hosted or larger runners.** A self-hosted runner can be faster and has no usage charge. Rejected: it ties every build to one machine being switched on, and a public repo should not run pull request code on a personal machine. Larger runners are always charged for. Standard runners are [free for a public repo](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

## Fitness functions

| Check | What it asserts | Where it runs | What it catches |
| --- | --- | --- | --- |
| Main is protected | The repo's settings refuse direct pushes to main and require the gate on pull requests. | On a schedule | Protection being switched off, which no pull request would show. |
| Deploys come only from main | The deploy workflow triggers only on a green run on main. | CI | A deploy path from a branch or a manual trigger. |
| One environment | The deployment definition names exactly one environment. | CI | A second environment appearing. |
| One gate | The CI workflow runs the same single command a developer runs locally. | CI | Checks that exist only in CI, or only locally. |
| No long-lived keys | A secret scan finds no cloud keys in the repo, and the workflows hold none. | CI | A static credential being committed or configured. |
| Standard runners only | Every workflow job names a standard GitHub-hosted runner. | CI | A self-hosted or larger runner creeping in. |

## Consequences

**Easier**

- There is one path to production, and what is on main is what is live.
- Every change has a pull request with a green gate behind it, which is the record a reviewer can read.
- An agent can take a change from a ticket to a pull request unattended, and the owner's part is the merge.
- One environment keeps cost and setup low.

**Harder, and accepted**

- There is nowhere to try a risky change before it is live. The remedy is a revert.
- The live demo can break while reviewers are looking at it. Main should be left alone once the submission is in.
- Anything that depends on a real third party, such as the OAuth redirect from Claude or Cursor, can only be proved in the live environment, after the merge.
- Settings held in third-party dashboards, such as the identity service, sit outside the repo and outside the gate. They are written down in the README.
- The gate has to fit what a standard runner can do. Standard runners are free for a public repo, so running it on every pull request has no usage charge.
