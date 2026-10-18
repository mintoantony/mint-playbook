# mint-playbook

A Claude Code plugin that runs an AI-native SDLC on any project, new or existing. From a one-line
idea it drafts `intent.md` → `spec.md` → `plan.md` → `tasks.md` and stops for your approval after
each one. Then it builds the independent tasks in parallel git worktrees, reviews the branch,
writes release notes, and opens a GitHub pull request (or leaves a local branch).

- Every document is a human gate. Only you can approve, reject or reopen one.
- Code is written only by builder agents, each in its own worktree, after the `tasks` gate.
- Nothing is pushed until you approve the `release` gate.

Requirements: Claude Code, git, Node.js 18 or later. `gh` is optional; you need it for the PR.
The plugin has no npm dependencies.

## Install

In Claude Code:

```
/plugin marketplace add D:\mint-playbook
/plugin install mint-playbook@mint-playbook
```

Restart Claude Code afterwards. To try it without installing, start Claude Code
with `claude --plugin-dir D:/mint-playbook`.

The hooks do nothing in a repository that has no `.playbook/state.json`, so you can leave the
plugin on everywhere.

## Quick start

In the project's folder:

```
/mint-playbook:playbook "a CLI that converts CSV to JSON"
```

The playbook:

1. Runs `git init` and makes an initial commit if the folder is not a repository yet (it asks
   first).
2. Creates the playbook state (`.playbook/`, gitignored) and a feature slug such as
   `csv-to-json-cli`.
3. Asks you questions one at a time, drafts `docs/playbook/<slug>/intent.md` and stops:

```
**intent is ready for your review:** `docs/playbook/csv-to-json-cli/intent.md`
...
To approve, type:  /mint-playbook:approve intent
To reject, type:   /mint-playbook:reject intent "<what to change>"
```

Read the document, then type one of the two commands. After an approval the playbook goes on to
the next step. Run `/mint-playbook:playbook` with no idea at any time to resume where you
stopped. It reads the state, so a new session works too.

## Stages and gates

| # | Step | Skill | Output (in `docs/playbook/<slug>/`) | Gate |
|---|---|---|---|---|
| 1 | Capture the intent (questions, one at a time) | `capture-intent` | `intent.md` | `intent` |
| 2 | Spec: discovery of existing code, or a stack choice; R1..Rn, design, constraint → control table, areas of concern | `write-spec` | `spec.md` | `spec` |
| 3 | Plan: files, order of work, risks, proof | `plan-mode` | `plan.md` | `plan` |
| 4 | Split into independent tasks and draft bootstrap proposals | `split-tasks`, `claude-md` | `tasks.md`, `bootstrap/` | `tasks` |
| 5 | Build in parallel waves: branch, test baseline, T0 applies the bootstrap, builders, merges, verifier | `run-tasks`, `feedback-loop` | code and tests on `playbook/<slug>` | none (stops only on questions or failures) |
| 6 | Review: reviewer and security-reviewer in parallel; Important findings become fix tasks | `pr-review` | `review-report.md` | `review` |
| 7 | Release notes; after approval push and `gh pr create`, or leave the local branch | `release-gate` | `release-notes.md`, PR link | `release` |
| 8 | Maintain: control bands or an incident open a new feature at the `intent` gate | `close-the-loop` | new feature folder | `intent` |

How a gate works:

- The step requests the gate. Its status becomes `awaiting-approval` and the document's hash is
  recorded. The playbook shows an approval pack and stops.
- `/mint-playbook:approve <gate>` approves it. The approved document is then hash-locked, so a
  hook denies edits to it.
- `/mint-playbook:reject <gate> "<reason>"` sends the step back for rework with your reason.
  Put the reason in double quotes, and do not use `$` or backticks in it. The command runs
  through shell preprocessing, which would expand them.
- `/mint-playbook:reopen <gate>` unlocks an approved document. Every later gate becomes `stale`
  and must be approved again.

Gate statuses are `pending`, `awaiting-approval`, `approved`, `rejected` and `stale`.

**Bootstrap proposals.** The `tasks` step drafts project files into `docs/playbook/<slug>/bootstrap/`:
`CLAUDE.md`, `REVIEW.md`, `.gitattributes`, `.gitignore` entries and, only if you ask for them,
evals and CI workflows. It merges with files that already exist and never overwrites them. You
approve them together with `tasks.md`. Task `T0` applies them in the first wave.

**Branch and worktrees.**

- The documents are committed on your current branch.
- When the build starts, the playbook creates `playbook/<slug>` from that branch. The base branch
  is stored in `git config branch.playbook/<slug>.playbookBase`.
- Each builder works in `.claude/worktrees/agent-*`.
- Finished tasks are merged one at a time with the message `merge(<slug>): <id> <title>`.
  Files listed as `shared` use git's union merge driver. A project `.gitattributes` that marks
  them `binary` or `-merge` overrides this.
- A merge that adds test failures beyond the baseline is reset.
- Your main branch is never changed.

**Release.**

- Nothing is pushed until the `release` gate is approved.
- After you approve the gate, run `/mint-playbook:release` again. If `git remote get-url origin`
  and `gh auth status` both succeed, it asks you once, then pushes `playbook/<slug>` and opens a
  PR with `gh` against the base branch (`branch.playbook/<slug>.playbookBase`).
- Otherwise the work stays on the local branch, ready for you to push.

## Commands

All commands are namespaced `/mint-playbook:<name>`. You can also type `/<name>` when no other
plugin uses that name.

| Command | What it does |
|---|---|
| `/mint-playbook:playbook ["idea" \| slug]` | Start a feature from an idea, switch to a feature, or resume. This is a skill. There is deliberately no `commands/playbook.md`, because a command with the same name would hide the skill. |
| `/mint-playbook:intent`, `:spec`, `:plan`, `:tasks` | Write or revise one document directly. |
| `/mint-playbook:bootstrap` | Draft CLAUDE.md, REVIEW.md and related bootstrap proposals. |
| `/mint-playbook:build [slug]` | Run the approved tasks in parallel worktree waves. |
| `/mint-playbook:verify [all]` | Run the verifier on the last merged wave, or on the whole branch. |
| `/mint-playbook:review [slug]` | Review the branch, write `review-report.md` and request the `review` gate. |
| `/mint-playbook:release [slug]` | Write release notes, request the `release` gate, then push and open the PR. |
| `/mint-playbook:maintain [finding \| incident]` | Turn a production signal into a new feature that stops at `intent`. |
| `/mint-playbook:status [slug]` | Show where the feature stands and what comes next. |
| `/mint-playbook:statusline` | Offer to add the playbook status line to `~/.claude/settings.json`. It shows the setting and asks before writing. |
| `/mint-playbook:approve <gate>` | **Human only.** Approve a gate. |
| `/mint-playbook:reject <gate> "<reason>"` | **Human only.** Reject a gate with a reason. |
| `/mint-playbook:reopen <gate>` | **Human only.** Unlock an approved gate. Later gates become stale. |

Gates are `intent`, `spec`, `plan`, `tasks`, `review` and `release`.

The three human-only commands have `disable-model-invocation: true`. They run the CLI through
`!` preprocessing, which happens when the command expands, not as a tool call. Hook H1 also
blocks the agent from running `playbook.js approve|reject|reopen` through Bash.

### State CLI

`bin/playbook.js` is the only writer of `.playbook/`. Skills call it, and you can call it too:

```
node <plugin>/bin/playbook.js status | next --json | waves | tasks validate | config get
```

`node <plugin>/bin/playbook.js` with no arguments prints the full usage.

## Skills

| Skill | Role |
|---|---|
| `playbook` | Orchestrator. Works out the next action, runs that step, stops at every gate. |
| `capture-intent` | Questions and the intent-analyst draft give `intent.md`. |
| `write-spec` | Discovery or stack choice; the spec-architect draft gives `spec.md`. |
| `plan-mode` | The planner draft, then interrogation ("what could break, riskiest step, options not chosen"), gives `plan.md`. |
| `split-tasks` | The task-splitter draft, checked with `tasks validate` until it is clean, gives `tasks.md` plus bootstrap proposals. |
| `claude-md` | Bootstrap proposals; records the `setup`, `test`, `lint` and `format` commands. |
| `run-tasks` | Parallel wave orchestrator: builders, serial merges against the baseline, verifier, retries. |
| `feedback-loop` | The builder's discipline: one target command, a failing test first for bug fixes, proof pasted before "done". |
| `pr-review` | Review gate: diff and suite output go to reviewer and security-reviewer. |
| `release-gate` | Release notes, the `release` gate, push and PR. Also covers the deploy hook templates. |
| `close-the-loop` | Control bands (`bands.yaml` and a detector) and incidents start a new intent. |
| `evals` | Headless evals for CLAUDE.md and `.claude` changes, run in temporary worktrees. |
| `policy-skills` | Write a policy skill (security, brand, UX, compliance). Helps decide whether a rule belongs in a skill or in CLAUDE.md. |

## Agents

| Agent | Tools | Role |
|---|---|---|
| `intent-analyst` | Read, Write, Edit | Drafts `intent.md` from the question-and-answer transcript. |
| `spec-architect` | Read, Write, Edit, Glob, Grep, WebSearch | Discovery and `spec.md`, including areas of concern with owners. |
| `planner` | Read, Glob, Grep, Write, Edit | Drafts `plan.md`. |
| `task-splitter` | Read, Write, Edit | Drafts `tasks.md`. The main session runs the validator. |
| `builder` | Read, Write, Edit, Bash, Glob, Grep | Implements exactly one task in its own worktree and reports the commit and the proof output. |
| `verifier` | Bash, Read, Glob, Grep | Checks a merged wave. It never fixes anything, and any change it leaves is discarded. |
| `reviewer` | Read, Grep, Glob | Finds bugs and checks compliance with the spec and plan. Read-only. |
| `security-reviewer` | Read, Grep, Glob | Security pass on the diff. Read-only. |
| `incident-analyst` | Read, Grep, Glob | Diagnoses a band finding or an incident. Read-only. |

Questions to you are always asked in the main session, because subagents cannot talk to the user.

## Hooks

| ID | Event / matcher | Behaviour |
|---|---|---|
| H0 | SessionStart | Adds the active feature, stage, pending or stale gates and the next step to the session. |
| H1 | PreToolUse `Bash\|PowerShell` | Denies commands that run `node ... playbook.js approve`, `reject` or `reopen`. Mentions of the words (a commit message, a grep pattern) pass. |
| H2 | PreToolUse `Edit\|Write\|MultiEdit\|NotebookEdit` (shared entry, see below) | **Gate and ownership guard.** It always denies `.playbook/state.json`, `config.json` and `approvals/**`, `release/approved-changes.json` (the release manager edits it outside Claude), the configured `protected` paths, and approved (hash-locked) documents. Before the `tasks` gate it allows only `docs/playbook/**`. After it, a builder worktree may write only its task's `owns` and `shared` files, and the main session may write only `docs/playbook/**`. A builder is a subagent (its hook payload carries `agent_id`) working in a linked worktree; your own session in a linked worktree counts as the main session. These gate rules apply only while the active feature is in flight (see below). |
| H3 | PreToolUse, shared entry with H2 | Test lock. For a bug-fix task, once the failing test is committed, it denies edits to that test: "fix the code, not the test". |
| H4 | PreToolUse, shared entry with H2 | Secret guard. It denies content that looks like a key or token, and gives a best-effort deny when reading `.env*` or `secrets/**`. |
| H5 | PostToolUse `Edit\|Write\|MultiEdit` | Runs the configured `lint` on the changed file only (not on files outside the worktree or under `docs/playbook/`). If lint fails, Claude gets the output and fixes it. It also records the last edit time for H8. |
| H7 | PreToolUse `mcp__.*deploy.*__release` | Release gate. Dev is allowed and staging asks you. Prod is denied unless the `review` and `release` gates are approved and `release/approved-changes.json` lists a ticket that matches the version. |
| H8 | SubagentStop | A builder cannot stop until a passing proof run (`playbook.js proof`) is recorded after its last edit. |

H2, H3 and H4 share one PreToolUse entry in `hooks/hooks.json`. Its matcher is
`Edit|Write|MultiEdit|NotebookEdit|Read`, and it runs one script, `hooks/pre-write.js`. In the design, H6 recorded proofs from
Bash output. Instead, the builder runs `playbook.js proof`, which runs the proof command and
records the result.

### After a feature is done

The gate and ownership rules of H2 apply only while the active feature is **in flight**: some
gate is not approved, or some task is not done. When every gate is approved and every task is
done, the main session can edit the project normally again. To leave a feature without finishing
it, run `node <plugin>/bin/playbook.js feature use --none`: with no active feature there are no
gate rules. `feature use <slug>` or `feature new <slug>` turns them back on. In every case the
always-deny set (`.playbook/`, `release/approved-changes.json`, `protected` paths, approved
documents), the secret guard (H4) and the test lock (H3) stay on.

### Enforcement strength

The hooks guard an **honest agent**. They stop Claude from approving its own gates, writing code
before the plan is approved, editing outside its task, changing a locked test, writing secrets,
or releasing to prod without approval. If a hook fails internally, it allows the action and logs
to stderr, so a broken hook never blocks your work. Three are exceptions and deny instead: the
approval guard (H1, only when the command matches), the state-file protection in H2, and the
release gate (H7), which also denies when `.playbook/state.json` is unreadable, because a
production release should fail closed.

The hooks are **not a security boundary**. A user, or an agent with an unrestricted shell, can
still change files through Bash or edit `.playbook/` by hand. For hard enforcement, use both of
these:

- **Managed settings**, deployed by an administrator through MDM or the admin console. Start from
  [`skills/claude-md/templates/managed-settings.example.json`](skills/claude-md/templates/managed-settings.example.json).
  It contains permission denies, a sandbox, `allowManagedHooksOnly` and
  `disableBypassPermissionsMode`. **Warning:** `allowManagedHooksOnly: true` disables every user,
  project and plugin hook, including this plugin's H0 to H8, so the gates are no longer
  enforced. The example sets it to `false`; set it to `true` only if you also deploy the plugin's
  hooks as managed hooks.
- **Branch protection and code-owner review** on the pull request, so nothing reaches the main
  branch without a human review.

## Configuration

Set with `node <plugin>/bin/playbook.js config set <key> <value>`. The values are stored in
`.playbook/config.json`. The `claude-md` skill fills in the commands for you.

| Key | Default | Meaning |
|---|---|---|
| `concurrency` | `3` | Most builders that run at the same time in one wave. Must be an integer of 1 or more. |
| `setup` | `null` | Install command that runs in each worktree, for example `npm ci`. `null` means none. |
| `test` | `null` | Command for the whole suite. It must exit non-zero on failure. It is used for the baseline and after each merge. |
| `lint` | `null` | Per-file lint command for H5. `{file}` is replaced by the worktree-relative path in double quotes; without it, the path is added at the end. A path with shell-special characters is never put in the command (lint is skipped with a note). The absolute path is always in the `PLAYBOOK_FILE` environment variable; a command that uses `PLAYBOOK_FILE` and no `{file}` gets nothing appended. |
| `format` | `null` | Formatter that runs once at the end of a task. |
| `testReport` | `null` | Path to a JUnit, TAP or JSON report. Failing test IDs are read from it for the baseline. Without it, the failure count is used. |
| `protected` | `[]` | Comma-separated globs that no agent may edit, for example `migrations/**,.github/**`. |

## Templates

Shipped under `skills/*/templates/`. The bootstrap proposes them, and each one is opt-in:

- `capture-intent`, `write-spec`, `plan-mode`, `split-tasks`: document templates.
- `claude-md`: `CLAUDE.md`, `REVIEW.md`, `.gitattributes` (`* text=auto`) and
  `managed-settings.example.json`.
- `evals`: `evals/example-eval.json`, `evals/run-evals.js`, `evals/check.js` and a workflow that
  runs on changes to CLAUDE.md, `.claude` or `evals`, and nightly.
- `pr-review`: `claude-review.yml` (claude-code-action PR review) and `policy-check.yml` (a
  required PR check).
- `release-gate`: a `.mcp.json` deploy-server example (dev, staging, prod) and
  `approved-changes.json` (for `release/approved-changes.json`, used by H7).
- `close-the-loop`: `bands.yaml`, `detect-bands.js` and a scheduled `bands.yml` workflow.
- `policy-skills`: a policy `SKILL.md` skeleton.

## Status line

`/mint-playbook:statusline` shows a line like
`▶ csv-to-json-cli · build · gate:review(pending) · tasks 4/9` in the status line. Outside a
playbook project it shows nothing. Plugins cannot set the status line themselves, so the command
shows the `statusLine` setting and writes it to `~/.claude/settings.json` only after you say yes.
It never replaces an existing status line without asking.

## Windows notes

- Paths are compared case-insensitively, so `d:\proj\src\a.js` is inside `D:\proj`. They are
  normalised to forward slashes. Use forward slashes in config globs.
- When the playbook has to `git init` a folder, it also sets `git config core.longpaths true`,
  because worktree paths under `.claude/worktrees/` can get long. Set it yourself in an existing
  repository.
- If removing a worktree fails because a file is locked, it is retried once.
- `evals/run-evals.js` finds `claude.exe` itself and runs it without a shell (the npm `claude`
  shim is a `.cmd` file).
- Node 18 or later is required. CI runs the plugin's tests on `windows-latest` and
  `ubuntu-latest` with Node 18 and 20.
- Git warns about LF → CRLF until the bootstrap `.gitattributes` (`* text=auto`) is applied.

## Development

```
npm test                               # node --test, no dependencies
claude plugin validate D:/mint-playbook
```

## Known limitations

- **Cost of one long session.** Running every document step in one session makes the context
  grow. In the smoke test, each later document step cost $1.3 to $1.8. Start a new session
  between stages and run `/mint-playbook:playbook` to resume; the state carries over. The build
  is the expensive stage. For a five-task CSV CLI, `/mint-playbook:build` plus the review that
  followed it cost about $8.8: 6 builders, 4 verifier runs, two rounds of review and one fix
  task. The session goes straight from build into review, so expect that cost to include the
  review.
- **Headless approval.** In `claude -p`, `/mint-playbook:approve <gate>` approves the gate, and
  then the model tries to continue the playbook in the same run. With a low `--max-turns` the run
  ends with `error_max_turns`, but the approval is already recorded. Check it with
  `playbook.js status`.
- **Hook denials are labelled "hook error".** Claude Code shows a PreToolUse deny as
  `PreToolUse:Write hook error: <reason>`. This is a deliberate deny, not a crash.
- **The hooks are not a security boundary.** See [Enforcement strength](#enforcement-strength).
  Writes made through Bash (`echo > src/x.js`) are not checked by H2.
- **Single repository.** The feature branch, worktrees and state all live in one git
  repository. Monorepos work, but a feature cannot span several repositories.
- **The design's H6 hook is replaced by `playbook.js proof`.** Proof runs done any other way are
  not recorded, so H8 asks the builder to run `playbook.js proof`.
