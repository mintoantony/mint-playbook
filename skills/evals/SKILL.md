---
name: evals
description: Sets up continuous evals that check CLAUDE.md and .claude changes keep Claude behaving well, by running real tasks headless in temporary worktrees and failing runs that touch files outside the allowed set. Use when the user wants evals, regression checks for CLAUDE.md or skills, turns an incident into an eval, or runs /evals.
---

# Evals

Evals answer one question: after this change to `CLAUDE.md` or `.claude/`, does Claude still do the right thing on tasks we care about? Each eval replays a real task in a throwaway worktree and checks the result with plain commands.

Evals are opt-in. Task `T0` copies the templates only when the user accepted them.

## What to write

Aim for **20 to 50 real tasks**: work the team actually did or will do, not toy prompts. Start with five to ten and grow. **Every incident becomes an eval**: when Claude gets something wrong, or a shipped fix comes from a bug, add an eval that reproduces it before you fix the instructions.

One JSON file per eval in `evals/`:

| Field | Meaning |
|---|---|
| `name` | Short unique name, used in the output line |
| `source` | Where the task came from (ticket, incident, PR link) |
| `from` | Commit, tag or branch the worktree starts at (needs full history in CI) |
| `prompt` | The task, exactly as you would give it to Claude |
| `may_change` | Glob patterns of files Claude may change. Any other changed file fails the eval |
| `checks` | List of `{ "run": "<shell command>" }`. Each must exit 0 to pass |
| `allowedTools` | Optional. Defaults to `Read,Edit,Bash(make test)` |

See `templates/evals/example-eval.json`.

## Install into the project

Copy from this skill's `templates/` directory:

- `templates/evals/*` to `evals/` (`run-evals.js`, `check.js`, `example-eval.json`). The scripts have no dependencies and do not need the plugin.
- `templates/workflows/evals.yml` to `.github/workflows/evals.yml`.

Delete `example-eval.json` once the project has real evals. Add the `ANTHROPIC_API_KEY` repository secret.

The workflow runs on pushes and pull requests that touch `CLAUDE.md`, `.claude/**` or `evals/**`, and nightly.

## How a run works

For each `evals/*.json`, `run-evals.js` adds a temporary worktree at `from`, copies the current `CLAUDE.md` and `.claude/` into it, and runs `claude -p <prompt> --allowedTools <tools> --output-format json`. It never passes `--bare`, because that skips `CLAUDE.md`, skills and hooks, which are what the eval tests. It then lists the changed files, fails the eval if any is outside `may_change`, runs each check, and removes the worktree.

Output is one line per eval, such as `PASS name (5/5 checks)` or `FAIL name (4/5 checks)`, then `N eval(s) failed`. The exit code is 1 if any eval failed.

## Run locally

From the project root, with Claude Code installed and logged in or `ANTHROPIC_API_KEY` set:

```
node evals/run-evals.js
```

Evals call the model, so they take time and cost tokens. Run a subset by moving other files out of `evals/` temporarily.

## Keeping evals useful

- A check should test behaviour (tests pass, a file contains the fix), not wording.
- Keep `may_change` tight: it catches Claude wandering into unrelated files.
- A flaky eval is a bad eval. Fix its checks or remove it.
