---
name: capture-intent
description: Turns a small idea into docs/playbook/<slug>/intent.md by questioning the user one question at a time, drafting with the intent-analyst agent, and requesting the intent gate. Use when the playbook's next action is write-intent, when the intent gate was rejected, or when the user runs /intent.
---

# Capture intent

You run the brainstorm in the main session, because only you can talk to the user. The `intent-analyst` agent drafts the document from your transcript.

This skill's base directory is shown when it loads. Run the CLI as `node "<skill base dir>/../../bin/playbook.js" <args>`; below, `playbook.js <args>` means that command.

## 1. Orient

1. Run `playbook.js next --json`. Note `feature` (the slug) and `doc` (`docs/playbook/<slug>/intent.md`).
   - `action` is `write-intent`, or `rework` with `gate` `intent`: continue.
   - `await-approval` for `intent`: go to step 6.
   - Any other `action`: intent is approved and locked. Tell the user that changing it needs `/mint-playbook:reopen intent`, and stop.
   - `next` fails with a `playbook: ...` error: show the error to the user and run the `mint-playbook:playbook` skill, which handles it. Stop here.
2. Run `playbook.js status` for the feature title (the idea).
3. If `doc` exists, read it: this is a revision. With a `reason`, the rejection says what to change.
4. Look at the project before asking anything: the top-level listing, README, manifest files. Skip any question the files already answer.

## 2. Brainstorm

Ask **one question per message** and wait for the answer. Keep going until all four targets are concrete:

| Target | Concrete when |
|---|---|
| Problem | You can name who has it, what happens today, and how often or how badly. |
| Proposed outcome | A stranger could check whether it was achieved. |
| Affected users and systems | Each user group and each system, file, service or API is named. |
| Constraints | Deadlines, platform, stack, must-not-change items and compliance are stated, or the user said there are none. |

How to ask:

- Prefer multiple choice with your recommended answer marked: "I'd guess A. Is that right, or B, or something else?"
- One topic per question. Follow up on a vague answer ("faster" → "faster than what, measured how?").
- In a revision, ask only what the rejection or the reopen needs.
- Stop when every target is concrete, or when the user says enough. Whatever is still unknown goes to Open questions.

Keep a transcript: each question and the user's answer, word for word.

## 3. Draft

Dispatch the `mint-playbook:intent-analyst` agent. Its prompt contains:

- the idea (feature title) and the slug
- the full transcript
- the author: `git config user.name`, or the name the user gave
- the template path: `<skill base dir>/templates/intent.md`, as an absolute path
- the output path: the absolute path of `doc`
- in a revision: the current document is at the output path, plus the rejection reason

## 4. Review the draft

Run the review loop in `<skill base dir>/../playbook/review-loop.md` with `type: intent`, the template from step 3, no upstream documents, and the transcript. A fresh `mint-playbook:doc-reviewer` reads the draft; fix what it finds (re-dispatch the intent-analyst for substantive fixes, ask the user one question at a time for "Needs user"), up to 3 rounds. It writes `docs/playbook/<slug>/reviews/intent.md`.

## 5. Commit and request

```
git add docs/playbook/<slug>/intent.md docs/playbook/<slug>/reviews/intent.md && git commit -m "docs(<slug>): intent draft"
playbook.js request intent
```

## 6. Hand back

If the `mint-playbook:playbook` skill sent you here, return to its loop: it shows the approval pack. Otherwise run the `mint-playbook:playbook` skill now; it shows the pack and stops.
