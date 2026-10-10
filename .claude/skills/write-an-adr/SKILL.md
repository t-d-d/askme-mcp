---
name: write-an-adr
description: "Write a decision record as a file in docs/adr/, with its constraint file. Use when the user asks for an ADR, or when work hits a decision that must bind future changes: one that adds, rewrites or deletes a rule in docs/constraints/. Size alone never triggers this. A large piece of work that changes no rule is an issue, not an ADR."
---

# Write a decision record

A decision record captures one technical decision: what forced it, the
alternatives, the choice, and the rule it puts in force. The record lives
in `docs/adr/`. The rule lives in `docs/constraints/`. They arrive in the
same pull request.

## When a decision deserves a record

Write one only when all four hold.

1. **It changes the rules.** The decision is something future editors must
   keep true, so it adds, edits or deletes a file in `docs/constraints/`.
   A one-time build choice, however large, changes no rule and is an
   ordinary issue.
2. **It is hard to reverse.** Changing your mind later would cost real work.
3. **It would surprise a reader.** Someone looking at the code later would
   wonder why it was done this way.
4. **There was a real trade-off.** Genuine alternatives existed and one was
   picked for stated reasons.

If it is easy to reverse, skip it. If there was no real alternative, there
is nothing to record.

A decision record is the owner's decision. Working unattended, do not
decide one yourself. Write up the question and the options in the issue or
the pull request, and stop.

## Steps

1. **State the decision in one sentence.** If you cannot, it is two
   decisions. Split it.

2. **Check for overlap.** Run
   `grep -H --exclude=README.md '^Relevance:' docs/constraints/*.md` and
   read the `Decision:` line of every file that touches the area.
   - Already covered as it stands: cite the constraint file and stop.
   - Needs a change of wording only, with the same meaning: edit the
     constraint file in an ordinary pull request and stop.
   - Needs a change of meaning, or is not covered: continue.

3. **Write the record** as `docs/adr/NNNN-short-name.md`, with the next
   free number. Follow the shape of the existing records.
   - **Title and lead.** `# ADR N: <the decision as a statement>`, then
     one paragraph starting "Decided on <date>:".
   - **Parent PRD** line, linking `PRD.md`.
   - **Constraint-set delta.** The constraint files this adds, edits or
     deletes, as links. Replacing an earlier decision means editing or
     deleting its constraint file here, and saying which record this one
     replaces.
   - **Context.** Why the decision is needed now. The forcing reason, not
     background.
   - **Decision.** One sentence first, then the numbered detail.
   - **Alternatives considered.** At least two real ones, each with why it
     was rejected. Flag any alternative an implementer is likely to
     reinvent. It becomes a `Do not` entry in the constraint file.
   - **Fitness functions.** At least one automated check that keeps the
     decision true: what it asserts and what it catches. Prefer a check in
     the gate, because one that blocks no merge is only a comment. What no
     check can see goes on the constraint file's `Judgment:` line.
   - **Consequences.** What gets easier and what gets harder. Both.

4. **Write or change the constraint file** in the format
   `docs/constraints/README.md` describes. The `Decision:` line is 160
   characters or fewer. Its `History:` line links the record.

5. **Update both indexes:** `docs/adr/README.md` and
   `docs/constraints/README.md`.

6. **Land the checks.** Each fitness function is a test whose describe
   name cites the constraint file: `fitness: <what it asserts> (<file>.md)`.
   They land with the code that first makes them meaningful. That can be
   this pull request or the issue that builds the feature. Say which.

A merged record is not edited, except to fix an error. A decision that
changes gets a new record.
