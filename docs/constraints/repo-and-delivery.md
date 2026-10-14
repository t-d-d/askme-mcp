# Repo and delivery
Relevance: Branch rules, CI, deploys, environments or repo layout: .github/workflows/**, infra/**, the gate command, repository settings
Decision: One repo on GitHub; main is protected and changes arrive by pull request; a green merge to main deploys to the one environment.

Why: Agents write the code and one person owns it, so automated
checks on a pull request stand in for a second reviewer. Every extra
environment doubles sign-in and connection setup.

## Rules

- All code, the deployment definition and the docs live in this repo,
  hosted on GitHub.
- A decision is a file in docs/adr/. The rules in force are in
  docs/constraints/.
- No direct pushes to main. Every change is a pull request.
- One command runs the whole gate, locally and in CI.
- CI and deploys run on GitHub Actions, standard hosted runners only.
- A pull request merges only with that gate green.
- A green merge to main deploys. Nothing else deploys, but for one
  exception: when the live check fails, or the deploy fails once its
  stack deploy has started, the same run redeploys the last build that
  passed the live check.
- There is one environment. No staging, no per-PR previews. The GitHub
  environment "conformance" labels a token and holds keys. Nothing
  deploys to it.
- CI reaches AWS with short-lived credentials only. Its stored
  secrets are the Serverless Framework access key, which only the
  deploy and its rollback use, and keys for conformance checks, kept
  as secrets of the GitHub environment "conformance" (test-tiers.md).
- A failed live check, or a deploy that fails once its stack deploy has
  started, redeploys the last build that passed the live check. The
  owner then reverts the pull request. The tag live-ok names that build.
  Only the job that moves it may write contents, and only after the
  live check passes. The run still ends failed.
- The rollback puts back the stack and the page, then runs that
  build's live tier. It does not touch the deploy role's stack.
- Before it deploys, the rollback waits for the app's stack to settle,
  and continues a failed CloudFormation rollback once, skipping
  nothing. If the stack is still stuck, it deploys nothing, and the run
  summary says why.
- A change to a stored item's shape keeps the previous build able to
  read it, or its pull request says why it cannot.

## Do not

- Deploy from a laptop: what is live drifts from main.
- Add a second environment to test safely: it doubles identity and
  agent-connection setup.
- Add a self-hosted or larger runner: a public repo should not run
  pull request code on a personal machine, and larger runners cost.
- Put the eval set in the gate: it costs money and is not
  deterministic.
- Add a manual trigger or a second workflow to roll back: it is a
  deploy path from somewhere other than the push to main.
- Roll back the deploy role's stack: an older template could take
  away what the current deploy needs, and the role runs the rollback.
- Roll back after a failure before the stack deploy: nothing live has
  changed, so the rollback is a wasted deploy.
- Skip resources or force a CloudFormation rollback: a skipped resource
  no longer matches the template, and a later update can leave the
  stack unrecoverable. Only the owner decides that, by hand.

Judgment: Branch protection lives in repository settings, which no
pull request can see. A scheduled check covers it. No check can see
whether the build before a change can read the items it writes. Its
pull request has to say.
History: [ADR 4](../adr/0004-repo-and-delivery.md), [ADR 15](../adr/0015-conformance-tier.md), [ADR 25](../adr/0025-roll-back-to-live-ok.md), [ADR 33](../adr/0033-roll-back-a-partial-deploy.md)
