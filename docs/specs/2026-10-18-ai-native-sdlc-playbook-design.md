# AI-Native SDLC Playbook — Design

Date: 2026-10-18 (rev 2, after Sonnet + Fable reviews)
Source: Claude Academy course "AI-native SDLC playbook" (14 lessons), https://academy.claude.com/courses/ai-native-sdlc-playbook

## 1. Intent and the why

The user wants one reusable playbook they can apply to **any project**. They type a small idea
in natural language; the playbook asks questions, turns the idea into `intent.md`, and carries it
through the course's six stages (Plan → Design → Build → Test → Deploy → Maintain) until the
product is built and verified. It stops for the user's approval after every document. After
`plan.md` it splits the work into independent tasks (`tasks.md`), and an orchestrator runs the
tasks that can run in parallel.

The course's thesis: keep humans accountable for judgment, but move the controls (policies,
reviews, gates) into artifacts the agent reads and hooks the harness enforces, so the process
does not stall on handoffs.

## 2. Goals

- G1. Installable Claude Code **plugin** (`mint-playbook`), usable in any repo, any stack.
- G2. Idea → `intent.md` via a questioning conversation (analyst-style, one question at a time).
- G3. Document chain per feature: `intent.md → spec.md → plan.md → tasks.md`, each stopping at a
  **human approval gate**, then `review` and `release` gates.
- G4. `tasks.md` with tasks made as independent as possible (file ownership, explicit
  dependencies, proof-of-done per task).
- G5. Parallel orchestrator: compute dependency waves from `tasks.md`, run each wave's tasks
  concurrently in isolated git worktrees via builder subagents, merge, verify, repeat.
- G6. Ship the course's mechanisms as plugin parts: skills, slash commands, subagents, hooks, a
  status-line mod, and project templates (CLAUDE.md, REVIEW.md, evals, CI workflows, bands.yaml,
  .mcp.json, managed-settings example).
- G7. Resumable: state on disk, so `/playbook` continues where it left off in a new session,
  including after a crash mid-wave.

## 3. Non-goals

- Not production infrastructure: no real deploy MCP servers, no real monitoring integration —
  templates and examples only, wired so a team can plug in their own.
- Not a replacement for the MINT-POC plugin; independent, no shared state.
- No managed-settings rollout (that's an admin/MDM task); an example file is provided.
- Not adversarial-proof: hooks stop an honest agent from skipping gates by mistake; hard
  enforcement against a determined agent is managed settings + branch protection (documented).

## 4. Anti-goals (failure even if it "works")

- Writing source code before the user approved `intent`, `spec`, `plan` and `tasks`.
- Self-approval: an agent marking a gate approved, or the authoring agent approving its own code.
- "Fixing" a failing test by editing the test.
- Parallel tasks clobbering each other's files or the integration branch left broken after a merge.
- Claiming done without pasted verification output.
- Asking a wall of questions at once instead of one at a time.

## 5. Constraints

- Platform: the user is on Windows (PowerShell + Git Bash); must also work on macOS/Linux.
  → **All hook and helper scripts are Node.js**, no npm dependencies, no bash/jq. Node required.
  Hook commands are `node "${CLAUDE_PLUGIN_ROOT}/hooks/<x>.js"` (quoted for spaces).
- All path matching normalises `\` → `/`, makes paths relative to the **worktree root** of the
  hook's `cwd`, and is case-insensitive on Windows.
- Every script resolves the **main repo root** via `git rev-parse --git-common-dir` so it finds
  `.playbook/state.json` from inside any worktree.
- Subagents cannot spawn subagents, so the orchestrator logic runs in the **main session**
  (a skill), dispatching builder subagents with the Agent tool using `isolation: "worktree"`.
  The Agent tool creates and names worktrees itself; the orchestrator cannot pre-seed them.
- Parallel execution requires git; the playbook runs `git init` + initial commit if missing
  (after telling the user). On Windows it sets `core.longpaths=true`. If the Agent tool places
  worktrees inside the repo (e.g. `.claude/worktrees/`), that path is added to
  `.git/info/exclude` so it never shows as untracked or gets committed.
- Default concurrency 3 (course: "start with two or three sessions"); configurable.

## 6. Decided by the user

- Reusable for any project; starts from a small natural-language idea.
- Claude may ask questions at any stage and continues until the final product is done.
- After `plan.md`, generate `tasks.md`; tasks as independent as possible.
- An orchestrator identifies parallelizable tasks and runs them.
- **Stop for approval after each document.**
- Works on **both new projects and existing codebases**.
- Finish line: work lives on a **feature branch `playbook/<feature-slug>`**; at the end it pushes
  and opens a **GitHub PR** if a remote and `gh` are available, otherwise stops with the branch
  ready locally.

## 6a. Builder's calls (made by Claude, not the user — check these)

- C1. **Gates** = every document: `intent`, `spec`, `plan`, `tasks`, `review`, `release`.
  Bootstrap files (CLAUDE.md, REVIEW.md, evals, workflows) are drafted as proposals in
  `docs/playbook/<slug>/bootstrap/` and approved inside the `tasks` pack; they are applied by
  task `T0` in wave 0. A Maintain-generated `intent.md` stops at a fresh `intent` gate.
- C2. **Approval is done by the human-only commands** `/approve <gate>` and
  `/reject <gate> "<reason>"`. Their command files have `disable-model-invocation: true` and run
  the CLI through inline `` !`node ".../playbook.js" approve $ARGUMENTS` `` preprocessing,
  which happens at expansion time, not as a tool call. The agent has no route to approve:
  H1 denies any Bash command containing `playbook.js` with `approve|reject`, and H2 denies direct
  writes to `.playbook/state.json`, `.playbook/config.json`, `.playbook/approvals/**`.
  *Build check:* verify empirically that `!` preprocessing in a plugin command works and that
  the model can't invoke the command; fallback is a `UserPromptSubmit` hook that performs the
  approval write itself when the human-typed prompt matches `/approve` or
  `/mint-playbook:approve`.
- C3. **Existing codebases:** the spec step starts with a discovery pass (stack, structure,
  commands, conventions, tests) recorded in spec.md "Current state"; stack choice only for new
  projects. `run-tasks` captures a **structured baseline** (failing test IDs via JUnit/TAP/JSON
  reporter, falling back to failure count) before wave 1; a merge is red only if it adds failures
  beyond the baseline. Bootstrap **merges** into existing CLAUDE.md/REVIEW.md (diff shown,
  never overwrites). Dirty working tree → ask the user to commit/stash before branching.
- C4. **Branching:** on `tasks` approval, create and check out `playbook/<feature-slug>` from the
  current branch (precondition for dispatch; repo with no commits gets an initial commit first).
  Task worktrees fork from it and merge back into it. Main is never touched. Push + PR only after
  the `release` gate is approved.
- C5. **Tracked vs untracked:** `docs/playbook/**` is committed; `.playbook/` is gitignored and
  holds all live state, including **task status** — tasks.md is read-only during Build and is
  rewritten with final statuses only by the orchestrator after the wave completes.
- C6. **Approved documents are hash-locked.** state.json stores each approved doc's hash; H2
  denies edits to an approved doc. `/reopen <gate>` (human-only, like `/approve`) unlocks it and
  marks every downstream gate `stale`, which must be re-approved.
- C7. **Phased build, all in scope.** The plan delivers in order: (1) state CLI + gates + hooks
  core, (2) intent→spec→plan→tasks skills/agents/commands, (3) run-tasks orchestrator,
  (4) review + release + PR, (5) bootstrap templates, evals, Maintain loop, release-gate,
  managed-settings example, status-line mod.

## 7. Design

### 7.1 Plugin layout (`D:\mint-playbook`)

```
.claude-plugin/plugin.json          # name, version, description, author; default dirs
                                    #   (commands/, agents/, skills/, hooks/hooks.json)
.claude-plugin/marketplace.json     # local marketplace so it installs with /plugin
README.md                           # install + usage + stage map + enforcement strength
bin/playbook.js                     # state CLI (single writer of .playbook/)
skills/
  playbook/            SKILL.md     # orchestrator: detect stage, run next step, stop at gates
  capture-intent/      SKILL.md + templates/intent.md
  write-spec/          SKILL.md + templates/spec.md
  plan-mode/           SKILL.md + templates/plan.md
  split-tasks/         SKILL.md + templates/tasks.md
  run-tasks/           SKILL.md     # parallel wave orchestrator
  feedback-loop/       SKILL.md     # verification discipline, failing-test-first
  claude-md/           SKILL.md + templates/CLAUDE.md
  policy-skills/       SKILL.md + templates/SKILL.md   # write org/project policy skills
  evals/               SKILL.md + templates/evals/*
  pr-review/           SKILL.md + templates/REVIEW.md, workflows
  release-gate/        SKILL.md + templates/.mcp.json example, release-gate config
  close-the-loop/      SKILL.md + templates/bands.yaml, detector, workflow
commands/
  playbook  intent  spec  plan  tasks  build  verify  review  release  maintain
  bootstrap  status  statusline           (model-invocable wrappers around skills)
  approve  reject  reopen                 (human-only: disable-model-invocation, `!` CLI)
agents/
  intent-analyst  spec-architect  planner  task-splitter  builder
  verifier  reviewer  security-reviewer  incident-analyst
hooks/hooks.json + hooks/*.js + hooks/lib/*.js
statusline/statusline.js            # mod (7.7)
test/                               # node --test suites + hook fixtures
docs/specs/ (this file)
```

### 7.2 Project-side layout (created in the target project)

```
.playbook/                 (gitignored)
  state.json               # active feature, gates {status, hash}, tasks {status, branch,
                           #   worktree, dispatched_at, attempts}, baseline, proof log
  config.json              # concurrency, setup/test/lint/format commands, protected paths
  approvals/               # approval records (who/when/gate/hash)
<worktree>/.playbook/active-task.json   # written by `playbook.js task start` inside a worktree
docs/playbook/<feature-slug>/   (committed)
  intent.md  spec.md  plan.md  tasks.md  bootstrap/  review-report.md  release-notes.md
CLAUDE.md  REVIEW.md  evals/  bands.yaml  .github/workflows/*   (applied by T0, opt-in)
```

The CLI writes JSON atomically (temp file + rename) with a lock file. Multiple features can
exist; `state.json` tracks the active one. A Maintain finding creates a new feature folder with
a fresh `intent.md` (the loop closes).

### 7.3 Stage flow and gates

| # | Stage | Step | Output | Gate |
|---|---|---|---|---|
| 1 | Plan | capture-intent (questions one at a time until concrete) | intent.md | `intent` |
| 2 | Design | write-spec (discovery for existing code; R1..Rn, design, constraint→control table, areas of concern, stack choice for new projects) | spec.md | `spec` |
| 3 | Build | plan-mode (files, order, risks, proof; interrogated for "what could break / riskiest step / options not chosen") | plan.md | `plan` |
| 3 | Build | split-tasks + bootstrap proposals; `tasks validate` run in main session | tasks.md, bootstrap/ | `tasks` |
| 3–4 | Build/Test | branch, baseline, T0 applies bootstrap, run-tasks waves | code, tests | — (stops only on questions/failures) |
| 5 | Deploy | reviewer + security-reviewer (fresh context, read-only, cannot approve), REVIEW.md rules | review-report.md | `review` |
| 5 | Deploy | release notes; after approval push branch + `gh pr create` (or leave local); release-gate hook active | release-notes.md, PR link | `release` |
| 6 | Maintain | bands.yaml + detector; incident → new intent.md | new feature folder | back to `intent` |

Gate mechanics: an agent runs `playbook.js request <gate>` (status `awaiting-approval`, hash
recorded) and stops, showing an approval pack (what to review, open questions, the exact
`/approve` and `/reject` commands). Rejection returns the stage for rework with the reason.

### 7.4 tasks.md format

Markdown with one block per task plus a fenced YAML (JSON-compatible subset) block the CLI parses:

```yaml
- id: T1
  title: Project skeleton and shared types
  covers: [R1]
  depends_on: [T0]
  owns: ["package.json", "package-lock.json", "src/types/**", "test/types/**"]
  shared: []                               # append-only files (route table, index exports)
  proof: "npm test -- types"
  kind: feature                            # feature | bugfix
```

Status is **not** stored here during Build (C5). Splitting rules (split-tasks skill): every R is
covered; `T0` = bootstrap; a foundation task owns skeleton, shared types, config, manifests and
lockfiles — any new dependency goes through it; `owns` must include the task's test globs; two
tasks may not own overlapping globs unless one depends on the other; files several tasks must
append to go in `shared`; each task has a runnable proof; prefer more smaller tasks over long
chains. `playbook.js tasks validate` checks coverage, cycles, overlap, test globs.
`playbook.js waves` prints waves.

### 7.5 Parallel orchestrator (run-tasks skill, main session)

1. Preconditions: on `playbook/<slug>`, clean tree, config has `setup` and `test` commands,
   baseline captured. On resume, reconcile state with `git worktree list` / branches.
2. `playbook.js waves --next` → tasks whose deps are all `done`, capped at concurrency.
3. Mark them `dispatched`; dispatch one **builder** per task in a single message,
   `isolation: "worktree"`. Builder rules, in order: (a) `playbook.js task start <id>` (writes
   worktree-local active-task.json); (b) run config `setup` (e.g. `npm ci`); (c) tests first,
   then code, editing only `owns` (+ appending to `shared`); (d) run proof with
   `PLAYBOOK_PORT_OFFSET=<n>` to avoid port clashes; (e) commit; (f) report branch, worktree
   path, commit SHA and pasted proof output. A builder that didn't commit → task `failed`.
4. Merge finished branches **serially** into `playbook/<slug>`; `shared` files are merged by the
   orchestrator (union of appends). After each merge run the full suite against the baseline.
   Conflict → `git merge --abort`; new failures → `git reset --hard ORIG_HEAD`; task `failed`.
5. After the wave's merges, one **verifier** run on the integration branch (fresh context,
   exercises the wave's changes and two neighbouring flows, reports only). Afterwards the
   orchestrator checks `git status`; any change the verifier left is discarded and flagged.
6. Failed task: one automatic retry with the failure output; second failure → finish the rest of
   the wave, then stop and ask the user. Tasks depending on it are `blocked`.
7. Clean up merged worktrees (`git worktree remove --force`, delete branch; on Windows retry once
   for file locks); write final statuses into tasks.md and commit; next wave.
8. All `done` → advance to review.

### 7.6 Hooks (hooks/hooks.json, Node scripts)

All hooks are no-ops when no `.playbook/state.json` is found via the main repo root, so the
plugin is safe to leave enabled everywhere. On internal error a hook allows and logs to stderr,
**except** H1 (deny only when the command text matches `playbook.js` + `approve|reject`) and
H2's state-file protection (deny).

| ID | Event / matcher | Behaviour |
|---|---|---|
| H0 | SessionStart | Inject active feature, stage, pending/stale gates, next step. |
| H1 | PreToolUse `Bash` | Deny commands running `playbook.js approve/reject/reopen` (human-only path is the command's `!` preprocessing). |
| H2 | PreToolUse `Edit\|Write\|MultiEdit\|NotebookEdit` | Gate guard. Always deny `.playbook/state.json`, `config.json`, `approvals/**`, configured protected paths, and hash-locked approved docs. Before `tasks` approved: allow only `docs/playbook/**`. After: in a worktree with active-task.json, allow only that task's `owns` + `shared`; in the main session, allow only `docs/playbook/**` (the orchestrator never implements). |
| H3 | PreToolUse `Edit\|Write\|MultiEdit` | Test protection: for a `bugfix` task whose failing test has been committed, deny edits to that test ("fix the code, not the test"). |
| H4 | PreToolUse `Write\|Edit\|MultiEdit` | Secret guard (write side): deny content matching secret patterns (cloud keys, private keys, tokens). Read-side protection is documented as managed-settings `permissions.deny` (`Read(.env*)` etc.); the hook adds a best-effort deny for `Read` of `.env*`/`secrets/**`. |
| H5 | PostToolUse `Edit\|Write\|MultiEdit` | Run configured **linter** on the changed file only; exit 2 with output so Claude fixes. Formatting runs once at task end (avoids invalidating the next Edit's `old_string`). |
| H6 | PostToolUse `Bash` | Proof recorder: when a command matches the active task's proof or the test command, log exit code + timestamp to state (via CLI). *Implemented as `playbook.js proof` (the builder runs the proof through the CLI, which records it); no PostToolUse Bash hook.* |
| H7 | PreToolUse `mcp__.*deploy.*__release` | Release gate: dev allow; staging ask; prod deny unless `review` and `release` gates approved and an approved change ticket matches the version; `hookSpecificOutput.permissionDecision` + reason. |
| H8 | SubagentStop | For a builder (active-task.json in cwd): block stop unless a passing proof run is logged after the last edit; honour `stop_hook_active` to avoid loops. |

Dropped from rev 1: the plan-sync text-matching hook (unreliable); plan.md divergence is instead
a checklist item in the builder and reviewer prompts.

### 7.7 Mod: status line

`statusline/statusline.js` prints `▶ <feature> · <stage> · gate:<name>(awaiting) · tasks 4/9`
when a playbook project is open, nothing otherwise. Plugins can't set `statusLine` themselves, so
`/mint-playbook:statusline` shows the setting it would add and writes it to the user's settings
only after they confirm (never overwriting an existing status line without consent). Built
following the `plugin-authoring` skill's mod conventions.

### 7.8 Agents

| Agent | Tools | Role |
|---|---|---|
| intent-analyst | Read, Write, Edit | Drafts intent.md from the Q&A transcript passed in its prompt |
| spec-architect | Read, Write, Edit, Glob, Grep, WebSearch | Discovery + spec.md incl. concerns with owners |
| planner | Read, Glob, Grep, Write, Edit | plan.md (files, order, risks, proof) |
| task-splitter | Read, Write, Edit | tasks.md per 7.4 (validation run by main session) |
| builder | Read, Write, Edit, Bash, Glob, Grep | Implements exactly one task in its worktree (7.5 step 3) |
| verifier | Bash, Read, Glob, Grep | Runs and checks; never fixes (changes discarded, 7.5 step 5) |
| reviewer | Read, Grep, Glob | REVIEW.md passes; Important vs Nit, ≤5 nits; orchestrator passes diff + test output |
| security-reviewer | Read, Grep, Glob | Security pass on the diff |
| incident-analyst | Read, Grep, Glob | Turns a breach/issue description into intent.md draft |

Question-asking happens in the main session (subagents can't converse with the user); agents
draft documents from answers gathered there.

### 7.9 Templates shipped (proposed in bootstrap/, applied by T0, each opt-in)

CLAUDE.md (Commands / Conventions / Architecture / Things Claude gets wrong / verification block,
under a page), REVIEW.md, `.gitattributes` (`* text=auto`), `.gitignore` entry for `.playbook/`,
`evals/` (example eval JSON + Node runner + GitHub workflow on changes to
CLAUDE.md/.claude/evals and nightly), PR review workflow using claude-code-action,
required-PR-check workflow re-running policy checks, `bands.yaml` + Node detector + scheduled
workflow stub, `.mcp.json` deploy example, `managed-settings.example.json`.

## 8. Left to the builder

- Exact wording of skills/prompts and templates (follow section 9 and the course's tone).
- Internal structure of `bin/playbook.js` and its YAML-subset parser.
- Secret regex list, status-line formatting details, command argument parsing.

## 9. Course specifics the templates must follow

- **intent.md:** header Author, Status; sections Problem, Proposed outcome, Affected users and
  systems, Constraints, Open questions. Brainstorm until concrete; product owner corrects before
  commit. Metric: time idea→committed intent.
- **spec.md:** numbered requirements R1..Rn; Design; constraint→control table; open questions
  carried forward; "Areas of concern" with owners; clashes between policy skills are *flagged,
  not resolved*. Policies (security, brand, UX, compliance) are applied from skills while writing.
- **plan.md:** Files that change; Order of work (citing R-ids); Risks (citing spec concerns);
  Proof. Interrogate: what could break, riskiest step, options not chosen. Done when "an
  engineer who has never seen the conversation could implement the change from the plan alone."
  Update plan.md in the same commit when implementation diverges.
- **CLAUDE.md:** start from `/init`, cut to day-one essentials, under a page; sections Commands,
  Conventions, Architecture, Things Claude gets wrong; verification block: "Run all three before
  reporting any task complete, and paste the output." / "If a test fails, fix the code, not the
  test." Rule: a mistake made twice goes into CLAUDE.md.
- **Policy skills:** for institutional knowledge applied consistently; SKILL.md frontmatter says
  when it triggers; may end with "run scripts/check-x and include output". "A skill is a control,
  though an advisory one" — must-hold policies get a hook or PR re-check behind them.
- **Feedback loop:** single target (`make test`/`npm test`) exiting non-zero; quantifiable;
  bug fix = failing test first, commit, then fix without touching the test; UI = screenshot
  compare loops (2–3 rounds).
- **Evals:** 20–50 real tasks; JSON fields `name, source, from, prompt, may_change, checks[{run}]`;
  run in CI on changes to `CLAUDE.md`, `.claude/**`, `evals/**` and nightly; per-eval
  `git worktree add` at `from`; `claude -p ... --allowedTools ... --output-format json`; never
  `--bare` (skips CLAUDE.md/skills/hooks); a checker fails runs touching files outside
  `may_change`; every incident becomes an eval. Output like `PASS name (5/5 checks)`.
- **REVIEW.md:** passes for bugs/logic, security, compliance vs spec.md/plan.md; "Important" only
  for findings that break behaviour, leak data or breach policy; at most five nits. Findings
  don't approve or block on their own; code-owner approval still required; the authoring agent
  can't approve its own code. `@claude` on a comment → fix and push.
- **Release gate:** dev allow, staging ask, prod deny unless approved change ticket matches
  version; `permissionDecision` + `permissionDecisionReason`. Non-interactive runs treat ask as
  deny. "The agent may act up to the production gate and cannot pass it." Rollback is a single,
  rehearsed command. `.mcp.json` example: deploy-dev/staging/prod http servers, bearer tokens
  from env (copy-in template; not auto-loaded by the plugin).
- **Managed settings example:** deny `Read(.env*)`, `Read(./secrets/**)`, `Bash(curl *)`,
  `Bash(wget *)`; allow `git`, make build/test/lint; `disableBypassPermissionsMode`, sandbox
  block, `allowManagedHooksOnly`, `allowManagedMcpServersOnly`. "A starting point to customize."
- **Maintain:** `bands.yaml` (metric, baseline rolling_30d, rules western_electric; tiers 1σ log,
  2σ diagnose read-only with limited tools, 3σ propose via PR or pre-approved runbook);
  deterministic detector (no deps); triggered by schedule/webhook; finding → intent.md; triage
  fix now / schedule / dismiss; each shipped fix gets an eval.
- **Parallel sessions:** worktree per session; start with 2–3; add only while review keeps up.
  **Verifier**: runs the app, exercises the change and two neighbouring flows, reports only,
  "Do not fix anything."

## 10. Verification of the plugin itself

- `node --test` unit tests for `bin/playbook.js` (state transitions, hash-lock + stale
  propagation, atomic writes, task validation, wave computation, worktree reconciliation) and
  each hook script fed fixture JSON on stdin — including Windows backslash paths, paths with
  spaces, and CRLF files.
- `claude plugin validate` on the plugin.
- The plugin repo's own CI (`.github/workflows/test.yml`) runs `node --test` on
  windows-latest and ubuntu-latest.
- Empirical checks before building on them: `!` preprocessing in a plugin command; model cannot
  invoke a `disable-model-invocation` command; SubagentStop payload for worktree-isolated agents
  (cwd); Agent-tool worktree location and branch naming.
- Smoke run: install locally, in a scratch repo run `/playbook "a CLI that converts CSV to
  JSON"`, approve through to tasks, run two waves in parallel, confirm H2 denies main-session
  source edits and out-of-scope builder edits, finish with a local branch (no remote).
