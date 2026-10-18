---
name: claude-md
description: Drafts the project bootstrap proposals (CLAUDE.md, REVIEW.md, .gitattributes, .gitignore entries, and opt-in evals and CI workflows) into docs/playbook/<slug>/bootstrap/, merging with any existing files, and records the project's setup, test, lint and format commands in the playbook config. Use when split-tasks needs bootstrap proposals, when the user wants a CLAUDE.md or review rules for the project, or when the user runs /bootstrap.
---

# Claude.md bootstrap

You propose the files that make Claude reliable in this project. Proposals go under `docs/playbook/<slug>/bootstrap/`; task `T0` copies them to the project root after the `tasks` gate. Never write the real root files: a hook blocks it before the gate, and the user approves proposals with the tasks gate.

This skill's base directory is shown when it loads. Run the CLI as `node "<skill base dir>/../../bin/playbook.js" <args>`; below, `playbook.js <args>` means that command. Templates are in `<skill base dir>/templates/`.

Ask **one question per message**, and prefer multiple choice with your recommendation marked.

## 1. Orient

Run `playbook.js next --json` and note `feature` (the slug). Create `docs/playbook/<slug>/bootstrap/` if it is missing.

If it fails with a `playbook: ...` error, show the error to the user and stop; the `mint-playbook:playbook` skill handles setup problems.

## 2. Commands

Find the project's commands before asking. Look at `package.json` scripts, `Makefile`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `.github/workflows/`, and `README.md`. For each of `setup`, `test`, `lint`, `format`:

- Found one: propose it in a single message with the others you found, and ask the user to confirm or correct.
- Found none: ask for it, one command per message. The user may answer "none".

Test, lint and format must each be a single command that exits non-zero on failure. Store every confirmed command:

```
playbook.js config set setup "<command>"
playbook.js config set test "<command>"
playbook.js config set lint "<command>"
playbook.js config set format "<command>"
```

Skip a key the user answered "none" for. A `playbook: ...` error (for example an unknown key) is shown to the user; do not edit `.playbook/config.json` by hand, a hook denies it.

## 3. CLAUDE.md

1. Read `<skill base dir>/templates/CLAUDE.md`. Fill it from the repository: the commands from step 2, conventions you can see in the code and config, a short architecture map. Keep it under one page; start from what `/init` would find, then cut to day-one essentials. Leave "Things Claude gets wrong" with only its rule line when you know of no mistakes yet.
2. No root `CLAUDE.md`: write the filled template to `docs/playbook/<slug>/bootstrap/CLAUDE.md`.
3. Root `CLAUDE.md` exists: write the **merged** file. Keep all existing content exactly. Append any of the four sections (Commands, Conventions, Architecture, Things Claude gets wrong) that are missing, and add the two verification sentences from the template if absent. Show the user a diff summary (sections kept, sections appended, lines added) and the output of `git diff --no-index --stat CLAUDE.md docs/playbook/<slug>/bootstrap/CLAUDE.md`.

## 4. The other proposals

- `REVIEW.md`: copy `<skill base dir>/templates/REVIEW.md` to `bootstrap/REVIEW.md`. If a root `REVIEW.md` exists, merge it the same way as CLAUDE.md (existing content kept, missing sections appended) and show a diff summary.
- `.gitattributes`: copy the template to `bootstrap/.gitattributes`. If a root `.gitattributes` exists, write the merged file: existing lines kept, `* text=auto` added when absent.
- `.gitignore.append`: write `bootstrap/.gitignore.append` listing the lines the root `.gitignore` lacks, among `.playbook/` and `.claude/worktrees/` (the Agent worktree directory). T0 appends them.

`<skill base dir>/templates/managed-settings.example.json` is not a proposal. It is for administrators to deploy by MDM or the admin console. Mention it to the user in one line and do not copy it.

Ask the user once whether to propose each of REVIEW.md and `.gitattributes`; skip those they decline. A declined file is not written.

## 5. Evals and CI workflows (opt-in)

Ask the user ONE multiple-choice question: which of these to propose (any combination, or none)?

- (a) Evals: copy `<skill base dir>/../evals/templates/evals/*` to `bootstrap/evals/`.
- (b) PR review workflows: copy `<skill base dir>/../pr-review/templates/workflows/claude-review.yml` and `policy-check.yml` to `bootstrap/.github/workflows/`.
- (c) Evals workflow: copy `<skill base dir>/../evals/templates/workflows/evals.yml` to `bootstrap/.github/workflows/`.

Skip any file whose target already exists in the project root (for example `.github/workflows/evals.yml` or `evals/run-evals.js`) and tell the user which were skipped. Declined choices are not written.

## 6. Report

List the files written to `bootstrap/` and the config keys set. If any workflow was proposed, say the repository needs the `ANTHROPIC_API_KEY` secret. Tell the user the proposals take effect only when the `tasks` gate is approved, and that they are covered by that approval. Return to the caller.
