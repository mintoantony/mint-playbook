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
2. Read `docs/playbook/<slug>/intent.md`. If `doc` exists, read it: this is a revision, and `reason` (if any) says what to change.
3. Decide the mode:
   - **existing**: the repo has source code outside `docs/`.
   - **new**: nothing but docs, licence, README or config.
4. Collect the policy skills: skills about security, brand, UX, compliance or coding standards, from your skill list and from `.claude/skills/*/SKILL.md` in the repo. Note each one's SKILL.md path.

## 2. Ask

Ask **one question per message**, and only what the files and the intent cannot answer:

- **new mode**: propose a stack (language, framework, test runner) with one line of reasoning, and ask the user to confirm or change it.
- Any intent open question that blocks a requirement.
- Any behaviour the intent leaves ambiguous (limits, error cases, who may do what).

Keep a transcript: each question and answer, word for word. In a revision, ask only what the reason or reopen needs.

## 3. Draft

Dispatch the `mint-playbook:spec-architect` agent. Its prompt contains:

- the slug, the mode, and the absolute path of `intent.md`
- the transcript
- the policy skill paths
- the template path: `<skill base dir>/templates/spec.md`, as an absolute path
- the output path: the absolute path of `doc`
- in a revision: the current document is at the output path, plus the reason

The agent reports concerns that need a person, policy clashes, and open questions.

## 4. Review the draft

Read the draft. Check:

- **Current state** cites real paths and commands (existing mode), or names the stack and why (new mode).
- **Requirements**: each is one testable behaviour, on its own line starting `- **R<n>**`. `tasks validate` finds requirement ids this way; it checks coverage later.
- Every intent outcome maps to at least one requirement.
- **Constraints and controls**: every constraint from the intent and the policy skills has a control (a hook, test, CI check or review rule).
- **Areas of concern**: every row has an owner.
- **Policy clashes** are flagged, with both sides, and left unresolved.
- Intent open questions are carried forward or answered.

Fix small issues with Edit.

## 5. Ask about concerns

For each concern whose owner is `ask user`, and each decision the agent reported only the user can make, ask **one question per message**. Write each answer into the spec.

## 6. Commit and request

```
git add docs/playbook/<slug>/spec.md && git commit -m "docs(<slug>): spec draft"
playbook.js request spec
```

## 7. Hand back

If the `mint-playbook:playbook` skill sent you here, return to its loop: it shows the approval pack. Otherwise run the `mint-playbook:playbook` skill now; it shows the pack and stops.
