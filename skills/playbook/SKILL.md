---
name: playbook
description: Drives one feature through the mint-playbook gates (intent, spec, plan, tasks, build, review, release), running the right step and stopping at every human approval gate. Use when the user wants to start a feature from a small idea, continue or resume a playbook, asks what's next, or runs /playbook.
---

# Playbook

You move one feature through the gates `intent → spec → plan → tasks → review → release`. The CLI owns the state. Ask it what to do next, do that one step, and stop at every gate.

## The CLI

This skill's base directory is shown when it loads. Run the CLI as:

```
node "<skill base dir>/../../bin/playbook.js" <args>
```

Below, `playbook.js <args>` means that command. Run it from the project root.

## Rules for the whole run

- **One question per message.** Wait for the answer before asking the next. Prefer a multiple-choice question with your recommendation marked.
- **The human approves.** Gates pass only when the user types `/mint-playbook:approve <gate>` or `/mint-playbook:reject <gate> "<reason>"`. Approving, rejecting and reopening are human-only commands; a hook blocks you from running them, so give the user the command to type.
- **Approved documents are locked.** A hook denies edits to them. To change one, the user types `/mint-playbook:reopen <gate>`; later gates then become stale and need approval again.
- **Documents first.** Until the `tasks` gate is approved, a hook allows writes only under `docs/playbook/`. Source code waits for the build.
- **Branch later.** The documents are committed on the current branch. The feature branch `playbook/<slug>` is created when the build starts, after the `tasks` gate.

## 1. Start

Run `playbook.js next --json` and branch on the result.

- **It prints JSON.** State exists. If the user passed a new idea (`$ARGUMENTS`) and the active feature is not `done`, ask one question: continue the active feature, or start a new one for the idea? For a new one, derive a slug (below) and run `playbook.js feature new <slug> --title "<title>"`. If they named an existing feature, run `playbook.js feature use <slug>`. Then go to 2.
- **`not a git repository`.** Tell the user: the playbook needs git for branches and worktrees, so you will run `git init` and commit the current files as an initial commit. Ask once. On yes:
  1. `git init`
  2. On Windows: `git config core.longpaths true`
  3. `git status --short`. If it lists dependency folders, build output or secret files (`node_modules/`, `dist/`, `.env`), write a `.gitignore` for them first.
  4. `git add -A && git commit --allow-empty -m "chore: initial commit"`
  5. Run `playbook.js next --json` again.

  On no: explain the playbook cannot run without git, and stop.
- **`not initialised`.** Take the idea from `$ARGUMENTS`; if empty, ask: "What do you want to build or change? A sentence or two is enough." Derive:
  - **slug**: 2 to 4 lowercase words joined by dashes, from the idea (`a CLI that converts CSV to JSON` → `csv-to-json-cli`).
  - **title**: the idea as a short phrase (`CSV to JSON CLI`).

  Run `playbook.js init <slug> --title "<title>"`, then commit `.gitignore` if `git status --short` shows it changed (`git add .gitignore && git commit -m "chore: ignore playbook state"`). Tell the user the slug in one line and go to 2.
- **`state unreadable`.** Show the error and stop. The user fixes or removes `.playbook/state.json`.

## 2. Loop

Run `playbook.js next --json`. It prints `{feature, stage, gate, action, doc, reason?}`. Do the row for `action`, then run `next` again. Stop where the row says stop.

| `action` | Do |
|---|---|
| `write-intent` | Run the `mint-playbook:capture-intent` skill. |
| `write-spec` | Run the `mint-playbook:write-spec` skill. |
| `write-plan` | Run the `mint-playbook:plan-mode` skill. |
| `split-tasks` | Run the `mint-playbook:split-tasks` skill. |
| `await-approval` | Show the approval pack and **stop** (section 3). |
| `rework` | Rework the gate (section 4). |
| `build` | Run the `mint-playbook:run-tasks` skill. |
| `write-review` | Run the `mint-playbook:pr-review` skill. |
| `write-release` | Run the `mint-playbook:release-gate` skill. |
| `done` | Tell the user the feature is finished, with the branch or PR link. Offer `/mint-playbook:playbook "<next idea>"` for the next one. **Stop.** |

Each document skill ends by requesting its gate, so the next `next` returns `await-approval`. A `write-*` action whose `doc` already exists means the gate was reopened or went stale: the step skill revises that document instead of starting fresh.

## 3. Await approval

Run this every time `next` returns `await-approval`, including when you already know the document.

1. Read the gate's document (`doc` from `playbook.js next --json`).
2. Send one message in exactly this shape:

```
**<gate> is ready for your review:** `<doc path>`

What it says:
- <3 to 5 bullets: what the document commits to, in plain words>

Open questions:
- <each item from the document's "Open questions" section, or "None">

To approve, type:  /mint-playbook:approve <gate>
To reject, type:   /mint-playbook:reject <gate> "<what to change>"
```

   - For `tasks`, add a "Bootstrap proposals" list (each file in `docs/playbook/<slug>/bootstrap/`, one line on what it adds) and the wave count from `playbook.js waves`. The approval covers both.
3. **Stop.** This message is the last of your turn, even when the next step is obvious. Recommendations or remarks go in the bullets, never in place of the two commands.

When the user answers:

- **They typed approve or reject.** The command reports the result and sends them back to the playbook. Run `playbook.js next --json` and carry on.
- **They wrote changes in chat instead.** Revise the document, commit it (`git add <doc> && git commit -m "docs(<slug>): <gate> revised"`), run `playbook.js request <gate>` again (this records the new version), and show a fresh pack.
- **They said "approved" or "looks good" in chat.** Approval is the command the user types. Reply with the two command lines again and wait.

## 4. Rework

`reason` holds the user's rejection. Repeat it back in one line, then run the step skill for `gate` with the reason:

| `gate` | Skill |
|---|---|
| `intent` | `mint-playbook:capture-intent` |
| `spec` | `mint-playbook:write-spec` |
| `plan` | `mint-playbook:plan-mode` |
| `tasks` | `mint-playbook:split-tasks` |
| `review` | `mint-playbook:pr-review` |
| `release` | `mint-playbook:release-gate` |

When the reason is unclear, ask one question about it first. The step skill revises the document and requests the gate again; then continue the loop.

## Status

When the user asks where things stand, run `playbook.js status` and summarise: feature, gate states, task counts, and the next action from `playbook.js next`.
