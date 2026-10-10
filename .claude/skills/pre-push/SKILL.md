---
name: pre-push
description: "Catch up to origin/main, run the gate on the merged tree, have the diff reviewed, then push and raise or update the pull request. Run before every push."
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

## 3. Have the diff reviewed

Start one sub-agent with a fresh context. Give it the branch diff, the
issue text and the matching constraint files. Ask for two things:
correctness, and whether the change is more complicated than the issue
needs.

Every finding ends one of three ways:

- **Dismissed** as wrong.
- **Fixed** in this branch.
- **Filed** as an issue, when it is unrelated to the branch or too big for
  a review fix. File it before pushing and link it under *Left for later*.
  A finding that exists only in a pull request body is lost at merge.

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
