---
name: policy-skills
description: Helps write a policy skill (security, brand, UX or compliance rules applied consistently) in the user's project, and decides whether a rule belongs in a skill or in CLAUDE.md. Use when the user wants to capture institutional knowledge as a skill, asks whether something belongs in CLAUDE.md or a skill, or when spec writing finds a policy with no skill yet.
---

# Policy skills

A policy skill carries institutional knowledge that must be applied the same way every time. This skill helps the user write one.

This skill's base directory is shown when it loads. Run the CLI as `node "<skill base dir>/../../bin/playbook.js" <args>`; below, `playbook.js <args>` means that command.

Ask **one question per message**, and prefer multiple choice with your recommendation marked.

## Skill or CLAUDE.md

- Short, true for every task, needed every session (commands, conventions, known mistakes): **CLAUDE.md**.
- Applies to some tasks only, is long or detailed, or needs a checklist or a script: **a skill**.
- A mistake made twice: add it to CLAUDE.md under "Things Claude gets wrong".

State your choice and the reason in one line, and let the user overrule it.

## A skill is a control, though an advisory one

A skill only works when the model reads and follows it. A policy that must hold needs enforcement behind it: a hook that blocks the action, or a PR check that re-tests it (the playbook's `policy-check` workflow, added with the PR review skill). Ask the user for each rule: must it hold, or is it guidance? Record the enforcement next to the rule, or say "advisory".

## Writing the skill

1. Ask for the policy's name (lowercase, dashes) and what it covers.
2. Ask when it should trigger: which files, tasks or documents. This becomes the `description`.
3. Ask for the rules, one at a time, until the user says that is all. State each so a reviewer can check it. Flag rules that clash with an existing policy skill in `.claude/skills/`; flag, do not resolve, and the user decides.
4. Ask whether a check script exists or is wanted (`scripts/<check>`). If yes, end the skill with "Run scripts/<check> and include its output in your summary."
5. Read `<skill base dir>/templates/SKILL.md` and fill it in. Frontmatter is flat, single-line: `name` and `description` only. The description says when the skill triggers.

## Where it goes

The output is `.claude/skills/<name>/SKILL.md` in the user's project. That is a project file, so write it only once the `tasks` gate is approved (run `playbook.js next --json`; the build stage has started). Before that, write the proposal to `docs/playbook/<slug>/bootstrap/skills/<name>/SKILL.md` (and the check script beside it), and have the user's tasks gate cover it: `T0` owns `.claude/skills/<name>/**`.

If `playbook.js next --json` fails with a `playbook: ...` error, show it to the user and stop.
