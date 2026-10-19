# Document review loop

The document skills (capture-intent, write-spec, plan-mode) run this loop right after a draft or a revision, before they commit and request the gate. A fresh reviewer reads the document; you fix what it finds; it reads again.

## Loop (at most 3 rounds)

1. Dispatch the `mint-playbook:doc-reviewer` agent with: `type`, the absolute `doc` path, the absolute `template` path, the absolute `upstream` paths (none for intent; intent.md for spec; intent.md and spec.md for plan), for intent the transcript, the `round` number, and from round 2 the previous round's findings.
2. **Verdict `clean`:** stop the loop. Fix any Minor findings that take a single Edit; leave the rest.
3. **Verdict `fix needed`:**
   - **Critical and Important:** fix every one. A local fix (a line, a missing row, a wrong path) is an Edit. A finding that changes the substance of a section goes back to the drafting agent (intent-analyst, spec-architect or planner) with the findings, the same way as a revision.
   - **Needs user:** ask the user, one question per message, and write the answer into the document.
   - **Minor:** fix the ones that take a single Edit.
   - Then start the next round.
4. After round 3, stop even if findings remain. They go into the review record as open, and the approval pack shows them.

Never skip the loop because the draft "looks fine", and never mark a finding fixed without changing the document.

## Review record

Write `docs/playbook/<slug>/reviews/<type>.md` and commit it with the document:

```
# <type> review

Rounds: <n>    Result: clean | open findings

## Fixed
- <finding> → <what changed>

## Open
- <finding still open, with severity>, or "None"

## Answered by the user
- <question> → <answer>, or "None"
```

A revision (after a rejection or chat changes) runs the loop again and rewrites the record.
