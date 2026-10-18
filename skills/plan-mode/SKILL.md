---
name: plan-mode
description: Writes docs/playbook/<slug>/plan.md from the approved spec - files that change, order of work citing R-ids, risks citing spec concerns, and proof - via the planner agent, interrogates it, then requests the plan gate. Use when the playbook's next action is write-plan, when the plan gate was rejected, or when the user runs /plan.
---

# Plan mode

The `planner` agent drafts the plan; you interrogate it in the main session until it passes the bar.

**The bar:** an engineer who has never seen the conversation could implement the change from the plan alone.

This skill's base directory is shown when it loads. Run the CLI as `node "<skill base dir>/../../bin/playbook.js" <args>`; below, `playbook.js <args>` means that command.

## 1. Orient

1. Run `playbook.js next --json`. Note `feature` (the slug) and `doc` (`docs/playbook/<slug>/plan.md`).
   - `action` is `write-plan`, or `rework` with `gate` `plan`: continue.
   - `await-approval` for `plan`: go to step 6.
   - An earlier gate is not approved: tell the user which, and stop.
   - A later gate: plan is approved and locked. Changing it needs `/mint-playbook:reopen plan`. Stop.
2. Read `intent.md` and `spec.md` in `docs/playbook/<slug>/`. If `doc` exists, read it: this is a revision, and `reason` (if any) says what to change.
3. Find the proof commands: the test, lint and build scripts in the manifest (`package.json`, `Makefile`, `pyproject.toml` and similar), or the stack chosen in the spec for a new project.

## 2. Draft

Dispatch the `mint-playbook:planner` agent. Its prompt contains:

- the absolute paths of `intent.md` and `spec.md`
- the proof commands you found
- any user answers so far (a revision's reason, decisions from step 4)
- the template path: `<skill base dir>/templates/plan.md`, as an absolute path
- the output path: the absolute path of `doc`

## 3. Interrogate

Read the draft and put three questions to it:

1. **What could break?** Each existing behaviour the change touches is a row in Risks, with how the plan detects a break.
2. **What is the riskiest step?** The plan names it and says why.
3. **Which options were not chosen?** The plan lists them with the reason.

Then check:

- **Files that change** gives a real path for each file (`Glob` to confirm existing ones).
- **Order of work**: every step cites R-ids; every spec requirement appears in at least one step; every step says how you know it is done.
- **Risks** cites the spec's Areas of concern; every concern appears.
- **Proof** gives runnable commands and what passing looks like.
- Read it as the engineer from the bar: no "as discussed", no undefined names, no step that needs the conversation.

Fix small gaps with Edit. For larger gaps, dispatch the planner again with the failed checks.

## 4. Ask

When the plan hinges on a choice the user owns (two viable options with different cost or scope), ask **one question per message**, recommendation marked. Record the answer in the plan; the option not taken goes under "Options not chosen".

## 5. Commit and request

```
git add docs/playbook/<slug>/plan.md && git commit -m "docs(<slug>): plan draft"
playbook.js request plan
```

## 6. Hand back

If the `mint-playbook:playbook` skill sent you here, return to its loop: it shows the approval pack. Otherwise run the `mint-playbook:playbook` skill now; it shows the pack and stops.
