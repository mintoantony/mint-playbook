---
name: write-spec
description: Writes docs/playbook/<slug>/spec.md from the approved intent - discovery of existing code or a stack choice for a new project, numbered requirements R1..Rn, design, constraint-to-control table and areas of concern with owners - via the spec-architect agent, then requests the spec gate. Use when the playbook's next action is write-spec, when the spec gate was rejected, or when the user runs /spec.
---

# Write spec

You gather answers in the main session; the `spec-architect` agent does discovery and drafts the document.

This skill's base directory is shown when it loads. Run the CLI as `node "<skill base dir>/../../bin/playbook.js" <args>`; below, `playbook.js <args>` means that command.

## 1. Orient

1. Run `playbook.js next --json`. Note `feature` (the slug) and `doc` (`docs/playbook/<slug>/spec.md`).
   - `action` is `write-spec`, or `rework` with `gate` `spec`: continue.
   - `await-approval` for `spec`: go to step 7.
   - An earlier gate is not approved: tell the user which, and stop.
   - A later gate: spec is approved and locked. Changing it needs `/mint-playbook:reopen spec`. Stop.
   - `next` fails with a `playbook: ...` error: show the error to the user and run the `mint-playbook:playbook` skill, which handles it. Stop here.
2. Read `docs/playbook/<slug>/intent.md`. If `doc` exists, read it: this is a revision, and `reason` (if any) says what to change.
3. Decide the mode:
   - **existing**: the repo has source code outside `docs/`.
   - **new**: nothing but docs, licence, README or config.
4. Collect the policy skills: skills about security, brand, UX, compliance or coding standards, from your skill list and from `.claude/skills/*/SKILL.md` in the repo. Note each one as the skill name, or its path when known.

## 2. Ask

Ask **one question per message**, and only what the files and the intent cannot answer:

- **existing mode**: keep the existing stack; do not propose another.
- **new mode**: propose a stack (language, framework, test runner) with one line of reasoning, and ask the user to confirm or change it.
- Any intent open question that blocks a requirement.
- Any behaviour the intent leaves ambiguous (limits, error cases, who may do what).

Keep a transcript: each question and answer, word for word. In a revision, ask only what the reason or reopen needs.

## 3. Draft

Dispatch the `mint-playbook:spec-architect` agent. Its prompt contains:

- the slug, the mode, and the absolute path of `intent.md`
- the transcript
- the policy skills: the SKILL.md path when known, otherwise the skill name with its rules copied in
- the template path: `<skill base dir>/templates/spec.md`, as an absolute path
- the output path: the absolute path of `doc`
- in a revision: the current document is at the output path, plus the reason

The agent reports concerns that need a person, policy clashes, and open questions.

## 4. Review the draft

Run the review loop in `<skill base dir>/../playbook/review-loop.md` with `type: spec`, the spec template, and `intent.md` as upstream. A fresh `mint-playbook:doc-reviewer` checks the draft (requirements on their own `- **R<n>**` lines, since `tasks validate` finds ids that way; every intent outcome covered; every constraint controlled; every concern owned); fix what it finds (re-dispatch the spec-architect for substantive fixes), up to 3 rounds. It writes `docs/playbook/<slug>/reviews/spec.md`. Leave "Needs user" findings about concerns to step 5.

## 5. Ask about concerns

For each concern whose owner is `ask user`, and each decision the agent reported only the user can make, ask **one question per message**. Write each answer into the spec.

## 6. Commit and request

```
git add docs/playbook/<slug>/spec.md docs/playbook/<slug>/reviews/spec.md && git commit -m "docs(<slug>): spec draft"
playbook.js request spec
```

## 7. Hand back

If the `mint-playbook:playbook` skill sent you here, return to its loop: it shows the approval pack. Otherwise run the `mint-playbook:playbook` skill now; it shows the pack and stops.
