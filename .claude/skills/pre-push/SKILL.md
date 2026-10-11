---
name: pre-push
description: "Catch up to origin/main, run the gate on the merged tree, run the code-review gate, then push and raise or update the pull request. Run before every push."
---

# Pre-push

Order: catch up, check, review, push. A check only counts against the merged tree.

## 1. Catch up

`git fetch origin main`, merge it in, and resolve conflicts until
`git diff --check` is clean.

## 2. Run the gate on the merged tree

- `npm run gate` if you touched code. For a docs-only change, skip it.
- Re-read each constraint file whose `Relevance:` line matches a path in
  your diff (`git diff --name-only origin/main...HEAD`). Confirm the diff
  keeps every rule in it.
- If the diff changes what a rule in `docs/constraints/` means, the pull
  request must also add a decision record in `docs/adr/`. A rule's
  meaning does not change without one. A change of wording only needs
  none.

## 3. Run the code-review gate

Run the `code-review` skill at `high --fix` over the branch diff against
main. At high effort it also reports findings it is unsure of, so judge
each one.

If the skill is not available, start two sub-agents with a fresh context
over the branch diff, one for correctness and one for conventions and
test quality. Give both the issue text and the matching constraint files.
Judge their findings and apply them yourself.

Every finding ends one of three ways:

- **Dismissed** as wrong. A finding that names a failure is dismissed only
  after you traced it through the code or ran it, and it did not happen.
  Saying it is wrong, or pointing at a line, is not enough.
- **Fixed** in this branch.
- **Filed** as an issue, when it is real but unrelated to the branch or
  too big for a review fix. File it before pushing and link it under
  *Left for later*, saying that it is real and why it waits, so nobody
  reads it as declined. A finding that exists only in a pull request body
  is lost at merge.

If the review changed code, run the gate again.

## 4. Push

Fetch `origin/main` again. If it moved and touches anything your diff
touches, go back to step 1. Then push the branch. Never push to main.

## 5. Raise the pull request

- Ready for review, not draft.
- Title and body: the `pr-description` skill. On an existing pull request,
  run it again over the final diff.
- Confirm the pull request is mergeable, then wait for the `gate` check.
  If it is red, fix it and push again. Finish only on a green gate.
- Do not merge it. The owner merges.
