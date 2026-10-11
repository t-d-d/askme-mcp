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
- A green merge to main deploys. Nothing else deploys.
- There is one environment. No staging, no per-PR previews.
- CI reaches the cloud with short-lived credentials only. Its stored
  secrets are the Serverless Framework access key, which only the
  deploy uses, and read-only keys that only the conformance workflow
  uses (test-tiers.md).
- Roll back by reverting the pull request.

## Do not

- Deploy from a laptop: what is live drifts from main.
- Add a second environment to test safely: it doubles identity and
  agent-connection setup.
- Add a self-hosted or larger runner: a public repo should not run
  pull request code on a personal machine, and larger runners cost.
- Put the eval set in the gate: it costs money and is not
  deterministic.

Judgment: Branch protection lives in repository settings, which no
pull request can see. A scheduled check covers it.
History: [ADR 4](../adr/0004-repo-and-delivery.md), [ADR 15](../adr/0015-conformance-tier.md)
