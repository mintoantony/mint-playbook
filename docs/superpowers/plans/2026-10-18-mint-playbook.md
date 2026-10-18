# mint-playbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code plugin that takes a small idea through intent → spec → plan → tasks (human-approved gates), builds the tasks in parallel worktree waves, reviews, and opens a PR — implementing the Claude Academy AI-native SDLC playbook.

**Architecture:** A dependency-free Node CLI (`bin/playbook.js` over `lib/*.js`) is the single writer of project state in `.playbook/`. Hooks (Node scripts sharing `lib/`) enforce gates, file ownership, test protection and secrets. Skills/commands/agents (Markdown) drive the stages; the `run-tasks` skill in the main session orchestrates builder subagents with `isolation: "worktree"`.

**Tech Stack:** Node.js ≥ 18 (CommonJS, `node:test`, no npm dependencies), git, Claude Code plugin format, optional `gh`.

**Spec:** `docs/specs/2026-10-18-ai-native-sdlc-playbook-design.md` (rev 2). Section 9 of the spec is the content source for every template and skill.

## Global Constraints

- No npm dependencies anywhere (plugin and shipped templates). Node ≥ 18 built-ins only.
- All scripts CommonJS, run as `node "<path>"`; hook commands in hooks.json are `node "${CLAUDE_PLUGIN_ROOT}/hooks/<x>.js"`.
- Paths: normalise `\`→`/`, relative to the worktree root of `cwd`, case-insensitive when `process.platform === 'win32'`.
- Main repo root always resolved via `git rev-parse --git-common-dir` (its parent dir).
- Gates, in order: `intent, spec, plan, tasks, review, release`. Gate status ∈ `pending | awaiting-approval | approved | rejected | stale`.
- Gate docs: `docs/playbook/<slug>/{intent,spec,plan,tasks}.md`, `review-report.md` (review), `release-notes.md` (release).
- `.playbook/` is gitignored; `docs/playbook/**` committed.
- Task status ∈ `todo | dispatched | in-progress | done | failed | blocked`.
- Default concurrency 3. Feature branch `playbook/<slug>`.
- Hooks: no-op when no state found; allow-on-internal-error except approval guard (deny only when command matches) and state-file protection (deny).
- Plugin name `mint-playbook`; commands are invoked as `/mint-playbook:<name>` (and `/<name>` when unambiguous).

## Review Focus

1. Windows absolute path with different drive-letter case (`d:\proj\src\a.js` vs root `D:\proj`) → H2 must treat it as inside the repo. Test in Task 8.
2. A write to a path outside the repo (scratchpad, `~/.claude/...`) → always allowed by H2. Test in Task 8.
3. `.playbook/state.json` missing or invalid JSON → every hook allows (no-op) and the CLI prints `playbook: state unreadable at <path>` with exit 1, not a stack trace. Tests in Tasks 4 and 7.
4. `tasks.md` without a fenced yaml block, or with a malformed entry → `tasks validate` exits 1 with `tasks.md:<line>: <problem>`, no crash. Test in Task 5.
5. Several builders calling the CLI at the same moment → no lost updates to state.json. Test in Task 3 (parallel child processes).

---

## File Map

```
.claude-plugin/plugin.json, marketplace.json
package.json                      # "test": "node --test"
bin/playbook.js                   # CLI argv dispatch → lib/cli/*.js
lib/paths.js   lib/store.js   lib/glob.js   lib/yaml-lite.js
lib/state.js   lib/tasks.js   lib/suite.js  lib/hookio.js
lib/guards.js                     # pure decide* functions used by hooks
lib/cli/*.js                      # one file per CLI command group
hooks/hooks.json
hooks/session-start.js  approval-guard.js  pre-write.js  post-edit.js
hooks/subagent-stop.js  release-gate.js
commands/*.md   agents/*.md   skills/<name>/SKILL.md (+ templates/)
statusline/statusline.js
test/*.test.js  test/fixtures/
.github/workflows/test.yml   README.md
```

---

### Task 1: Repo scaffold and structure test

**Files:**
- Create: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `package.json`, `.gitignore`, `test/structure.test.js`

**Interfaces:**
- Produces: `test/structure.test.js` with helpers `readFrontmatter(file) -> object` and checks extended by later tasks.

- [ ] **Step 1:** `git init` in `D:\mint-playbook`, `git config core.longpaths true`, commit the existing `docs/`.
- [ ] **Step 2: Write the failing test** `test/structure.test.js`:
  - `plugin.json parses and name === 'mint-playbook'`, has `version`, `description`, `author.name`.
  - `marketplace.json` lists plugin `mint-playbook` with `source: "./"`.
  - For every `skills/*/SKILL.md`: frontmatter `name` equals dir name, `description` non-empty.
  - For every `agents/*.md`: `name`, `description`, `tools` present.
  - For every `commands/*.md`: `description` present.
  - (Loops pass vacuously while dirs are empty.)
- [ ] **Step 3:** Run `npm test` → FAIL (files missing).
- [ ] **Step 4:** Create the files. `package.json`: `{"name":"mint-playbook","private":true,"scripts":{"test":"node --test"},"engines":{"node":">=18"}}`. `.gitignore`: `node_modules/`, `.playbook/`.
- [ ] **Step 5:** `npm test` → PASS. Commit `chore: scaffold mint-playbook plugin`.

### Task 2: Spike — verify harness behaviour the design depends on

Throwaway; produces findings only. Uses `claude --plugin-dir D:\mint-playbook -p ...` in a scratch git repo under the scratchpad.

**Files:**
- Create: `docs/specs/spike-findings.md` (kept); spike hooks/commands deleted after.

- [ ] **Step 1:** Add a temp command `commands/spike-approve.md` with `disable-model-invocation: true`, `allowed-tools: Bash(node:*)`, body ``!`node -e "require('fs').writeFileSync('spike.txt','ran')"` ``. Check (a) typing it in an interactive session runs the `!` line, (b) whether a PreToolUse Bash hook sees that `!` command, (c) `claude -p "run the /mint-playbook:spike-approve command"` cannot invoke it (spike.txt absent).
- [ ] **Step 2:** Add a temp `UserPromptSubmit` hook dumping stdin to a file; type `/mint-playbook:spike-approve x` and record whether `prompt` holds the raw slash text.
- [ ] **Step 3:** Add a temp `SubagentStop` and `PreToolUse` hook dumping stdin; have the main session dispatch a subagent with `isolation: "worktree"` that edits a file. Record: worktree path and branch naming, whether `cwd` in the subagent's PreToolUse/SubagentStop payload is the worktree, and fields present (`stop_hook_active`, `agent_type`?).
- [ ] **Step 4:** Write `docs/specs/spike-findings.md` with one line per question and the **decision**: approval path = `!`-preprocessing or `UserPromptSubmit` fallback; H8 keyed by payload `cwd` or fallback to orchestrator-only `task check`. Delete spike files. Commit `docs: spike findings`.

Later tasks follow the decisions recorded here; where a fallback is chosen, the alternative named in that task applies.

### Task 3: Core libraries — paths, store, glob, yaml-lite

**Files:**
- Create: `lib/paths.js`, `lib/store.js`, `lib/glob.js`, `lib/yaml-lite.js`
- Test: `test/paths.test.js`, `test/store.test.js`, `test/glob.test.js`, `test/yaml-lite.test.js`

**Interfaces — Produces:**
- `paths.mainRoot(cwd) -> string|null` (null outside git), `paths.worktreeRoot(cwd) -> string|null`, `paths.rel(absPath, root) -> string|null` (posix, null if outside root; case-insensitive on win32), `paths.stateDir(mainRoot) -> string`, `paths.featureDir(mainRoot, slug) -> string`.
- `store.readJson(file, fallback) -> any` (returns fallback when missing; throws `StoreError` with `.file` when invalid), `store.writeJsonAtomic(file, value)`, `store.withLock(file, fn) -> result` (lockfile `file + '.lock'`, `fs.openSync(..., 'wx')`, retry 50ms up to 5s, stale after 10s).
- `glob.match(pattern, relPath, {nocase}) -> boolean` supporting `**`, `*`, `?`; `glob.matchAny(patterns, relPath, opts)`.
- `yaml.parse(text) -> any` for the subset: block list of maps, scalars (string/number/bool/null), quoted strings, flow arrays `[a, "b"]`. Throws `YamlError` with `.line`.

- [ ] **Step 1: Write failing tests.** Key assertions:
  - `rel('D:\\p\\src\\a.js','d:/p')` → `'src/a.js'` on win32; `rel('/tmp/x','/p')` → `null`.
  - `mainRoot` inside a `git worktree add` dir returns the original repo root (test creates a temp repo).
  - `match('src/**','src/a/b.js')` true; `match('src/*.js','src/a/b.js')` false; `match('test/**/*.test.js','test/x.test.js')` true.
  - yaml: the tasks example in spec 7.4 parses to `[{id:'T1', covers:['R1'], depends_on:['T0'], owns:[...], shared:[], proof:'npm test -- types', kind:'feature'}]`; a bad indent throws `YamlError` with `.line === 3`.
  - Review Focus 5: spawn 8 child processes each doing `withLock` read-increment-write 25 times on one JSON file → final counter `200`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement. `glob.match` compiles to a RegExp (`**/` → `(?:.*/)?`, `**` → `.*`, `*` → `[^/]*`, `?` → `[^/]`, escape the rest).
- [ ] **Step 4:** `npm test` → PASS. Commit `feat(lib): paths, atomic store with lock, glob, yaml subset`.

### Task 4: State model and gate CLI

**Files:**
- Create: `lib/state.js`, `lib/cli/gates.js`, `lib/cli/feature.js`, `bin/playbook.js`
- Test: `test/state.test.js`, `test/cli-gates.test.js`

**Interfaces:**
- Consumes: Task 3.
- Produces:
  - `state.GATES` (ordered array), `state.gateDoc(gate) -> filename`.
  - `state.load(mainRoot) -> State|null`, `state.update(mainRoot, fn)` (lock + atomic).
  - State shape: `{version:1, activeFeature, features:{[slug]:{title, branch, createdAt, gates:{[gate]:{status, hash, requestedAt, approvedAt, reason}}, tasks:{[id]:{status, branch, worktree, sha, dispatchedAt, attempts}}, extraTasks:[], baseline:null|{failing:string[], count:number}, approvals:[]}}}`.
  - `state.hashFile(path) -> 'sha256:<hex>'` (normalise CRLF→LF before hashing).
  - `state.request(st, slug, gate, hash)`, `state.approve(st, slug, gate, hash)`, `state.reject(st, slug, gate, reason)`, `state.reopen(st, slug, gate)` → marks every later gate that is `approved|awaiting-approval` as `stale`.
  - `state.currentStep(st, slug, mainRoot) -> {stage, gate, action}` where action ∈ `write-intent|write-spec|write-plan|split-tasks|await-approval|rework|build|write-review|write-release|done`.
  - CLI: `init <slug> --title <t>` (creates `.playbook/`, `config.json` defaults `{concurrency:3, setup:null, test:null, lint:null, format:null, testReport:null, protected:[]}`, adds `.playbook/` to `.gitignore`), `status [--json]`, `next [--json]`, `feature new <slug> --title`, `feature use <slug>`, `request <gate>`, `approve <gate>`, `reject <gate> <reason...>`, `reopen <gate>`.
- [ ] **Step 1: Failing tests:**
  - `request('spec')` when `intent` not approved → error `gate intent must be approved first`.
  - `request` records hash; `approve` when doc hash changed since request → error `spec.md changed since approval was requested; run request again`.
  - `reopen('spec')` with plan approved and tasks awaiting → plan `stale`, tasks `stale`, intent untouched.
  - `approve` appends `{gate, hash, at, by:'human'}` to `approvals` and writes `.playbook/approvals/<slug>-<gate>.json`.
  - `currentStep` walks the full sequence for a fresh feature: `write-intent` → after request `await-approval` → after approve `write-spec` … → `done` after release approved.
  - Review Focus 3: CLI `status` with invalid state.json → stderr `playbook: state unreadable at <path>`, exit 1.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; `bin/playbook.js` maps `argv[2]` to a `lib/cli/*.js` handler, prints errors as `playbook: <msg>` and exits 1. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(cli): state model, gates with hash lock and stale propagation`.

### Task 5: Tasks — parse, validate, waves, task lifecycle

**Files:**
- Create: `lib/tasks.js`, `lib/cli/tasks.js`
- Test: `test/tasks.test.js`, `test/fixtures/tasks-*.md`

**Interfaces:**
- Consumes: Tasks 3–4.
- Produces:
  - `tasks.parse(md) -> {tasks: Task[], errors: {line, msg}[]}`; reads the first ```` ```yaml ```` block. `Task = {id, title, covers[], depends_on[], owns[], shared[], proof, kind}`.
  - `tasks.validate(tasks, requirementIds) -> {line?, msg}[]` checking: every R in spec covered; unique ids; deps exist; no cycles (message names the cycle `T2 -> T3 -> T2`); overlapping `owns` only if one transitively depends on the other; each task has `proof`; each task's `owns` includes at least one glob containing `test` or `spec` unless `kind` is `bootstrap`; `T0` present.
  - `tasks.requirementIds(specMd) -> string[]` (matches `^\s*[-*#]*\s*\**(R\d+)\b`).
  - `tasks.waves(tasks, statusById) -> string[][]`; `tasks.nextWave(tasks, statusById, limit) -> string[]` (deps all `done`, status `todo` or `failed` with attempts < 2).
  - CLI: `tasks validate`, `waves [--next] [--json]`, `task start <id>` (run in a worktree: writes `<wt>/.playbook/active-task.json` = task + `{startedAt, lockedTests:[], lastEditAt:null, proofs:[]}`; sets main state status `in-progress`, records `worktree`, current branch), `task set <id> <status> [--branch b --worktree w --sha s]`, `task add <id> --title --owns a,b --proof <cmd> [--depends T3]` (into `extraTasks`), `task lock-tests <path...>`, `proof` (in a worktree: runs the active task's proof via shell, streams output, appends `{at, exit}` to active-task.json and main state, exits with the proof's code), `task check <id>` (exit 0 only if last proof passed and is newer than `lastEditAt`), `progress` (writes `docs/playbook/<slug>/progress.md` table of task statuses). Plan's call, deviating from spec C5: approved tasks.md is hash-locked (C6), so final statuses go to `progress.md` instead of being rewritten into tasks.md.
- [ ] **Step 1: Failing tests:** cycle detection message; overlap `src/**` vs `src/api/**` between independent tasks → error naming both; waves for T0→{T1,T2}→T3 = `[['T0'],['T1','T2'],['T3']]`; `nextWave` limit 1 returns one id; Review Focus 4 (no yaml block → `tasks.md:1: no yaml task block found`; entry missing `id` → line-numbered error); `task check` false when `lastEditAt` > last proof.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(cli): tasks validation, waves, task lifecycle and proof recording`.

### Task 6: Test-suite baseline and check

**Files:**
- Create: `lib/suite.js`, `lib/cli/suite.js`
- Test: `test/suite.test.js`, `test/fixtures/{tap,junit}-*.txt`

**Interfaces — Produces:**
- `suite.parseFailures(output, reportXml|null) -> {failing:string[]|null, count:number|null}`: TAP `not ok N - name` → `name`; JUnit `<testcase name classname>` with `<failure|error>` → `classname.name`; else nulls.
- `suite.compare(baseline, current, exitCode) -> {ok:boolean, newFailures:string[]}`: with ids, ok iff no id outside baseline; with counts only, ok iff `count <= baseline.count`; with nothing, ok iff `exitCode === 0` or baseline also failed with same exit code.
- CLI: `suite baseline` (runs `config.test`, stores baseline), `suite check` (runs again, prints `suite: ok` or `suite: new failures: a, b`, exit 0/1). Errors `config.test not set; set it in .playbook/config.json` when missing.
- [ ] Steps 1–5 as usual: tests for TAP, JUnit, count fallback, exit-code fallback; commit `feat(cli): baseline-aware test suite check`.

### Task 7: Hook I/O, SessionStart (H0) and approval guard (H1)

**Files:**
- Create: `lib/hookio.js`, `hooks/session-start.js`, `hooks/approval-guard.js`, `lib/guards.js` (start)
- Test: `test/hooks-h0-h1.test.js`, `test/fixtures/hook-*.json`

**Interfaces:**
- Produces:
  - `hookio.run(handler)` — reads stdin JSON, calls `handler(input) -> result|null`, writes JSON to stdout; on thrown error calls `handler.onError` (default: log to stderr, exit 0).
  - `hookio.deny(event, reason)` → `{hookSpecificOutput:{hookEventName:event, permissionDecision:'deny', permissionDecisionReason:reason}}`; `hookio.ask(...)`, `hookio.allow(...)` likewise; `hookio.context(event, text)` → `{hookSpecificOutput:{hookEventName:event, additionalContext:text}}`.
  - `guards.decideApprovalCommand(command) -> null|reason` — matches `/playbook(\.js)?["']?\s+(approve|reject|reopen)\b/` (also with quote-splitting tolerance: strip `"` and `'` before matching).
- [ ] **Step 1: Failing tests** (spawn the script with fixture stdin):
  - H0 with a state at `await-approval` for `spec` → `additionalContext` contains `mint-playbook: feature <slug>, gate spec awaiting your approval — /mint-playbook:approve spec`.
  - H0 / H1 in a dir with no state → empty stdout, exit 0 (Review Focus 3 with corrupt state too).
  - H1 `node "C:/x/bin/playbook.js" approve spec` → deny with reason `Gates are approved only by the human typing /mint-playbook:approve`; `node bin/playbook.js ap""prove spec` → deny; `npm test` → no output.
  - H1 internal error with matching command → deny (its `onError`).
- [ ] **Step 2–4:** FAIL → implement → PASS. If Task 2 chose the `UserPromptSubmit` fallback, also create `hooks/approval-prompt.js`: when `prompt` matches `^/(mint-playbook:)?(approve|reject|reopen)\s+(\w+)(.*)$`, it calls the state functions directly and returns `additionalContext` with the result; test it here.
- [ ] **Step 5:** Commit `feat(hooks): session context and approval guard`.

### Task 8: Pre-write guard (H2 gate/ownership, H3 tests, H4 secrets)

**Files:**
- Create: `hooks/pre-write.js`; extend `lib/guards.js`
- Test: `test/hooks-pre-write.test.js`

**Interfaces:**
- Produces in `guards.js` (pure, no fs except via args):
  - `decideWrite({relMain, relWt, inMainSession, state, slug, activeTask, config}) -> null|reason` (H2, rules exactly as spec 7.6; hash-locked doc = gate `approved` and file is that gate's doc).
  - `decideTestEdit({relWt, activeTask}) -> null|reason` (H3: `activeTask.kind === 'bugfix'` and path in `lockedTests` → `fix the code, not the test (<path> is locked for this bug fix)`).
  - `decideSecrets({toolName, relMain, content}) -> null|reason` (H4: content patterns — `AKIA[0-9A-Z]{16}`, `-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----`, `gh[pousr]_[A-Za-z0-9]{36}`, `xox[baprs]-[A-Za-z0-9-]{10,}`, `sk-[A-Za-z0-9]{32,}`; `Read` of `.env*` (except `.env.example`) or `secrets/**`).
  - `pre-write.js` handles `Edit|Write|MultiEdit|NotebookEdit|Read`; content = `new_string`, `content`, or joined `edits[].new_string`.
- [ ] **Step 1: Failing tests:**
  - Before tasks approved: write `src/a.js` → deny `Code changes wait for the tasks gate (current: plan awaiting approval)`; write `docs/playbook/x/spec.md` → allow.
  - Approved `intent` → edit `docs/playbook/x/intent.md` → deny `intent.md is approved and locked; ask the user to run /mint-playbook:reopen intent`.
  - `.playbook/state.json` write → deny always.
  - Worktree with active task owning `src/api/**`: `src/api/x.js` allow, `src/ui/y.js` deny naming the task and its globs, a `shared` file allow.
  - Main session after tasks approved: `src/a.js` deny `The orchestrator does not implement; dispatch a builder`.
  - Review Focus 1 and 2 (drive-letter case; path outside repo → allow).
  - H3 and H4 cases above; `.env.example` read allowed.
- [ ] **Step 2–4.** **Step 5:** Commit `feat(hooks): gate, ownership, test and secret guards`.

### Task 9: Post-edit (H5 lint + edit tracking) and SubagentStop (H8)

**Files:**
- Create: `hooks/post-edit.js`, `hooks/subagent-stop.js`
- Test: `test/hooks-post.test.js`

**Interfaces:**
- `post-edit.js`: if `config.lint` set, run it with `{file}` replaced by the quoted absolute path (timeout 20s); non-zero → write output to stderr, exit 2. In a worktree with active task, set `lastEditAt` in active-task.json. (Merges spec H6's role: proofs are recorded by `playbook.js proof`, not by parsing Bash output — plan's call, because PostToolUse Bash payloads don't reliably carry exit codes.)
- `subagent-stop.js`: if `stop_hook_active` → allow. Locate active-task.json via payload `cwd` (per Task 2 findings); if found and `task check` logic fails → `{decision:'block', reason:'Run `node "<plugin>/bin/playbook.js" proof` and paste the output before finishing.'}`. If Task 2 found `cwd` is not the worktree, this hook is omitted from hooks.json and the orchestrator's `task check` (Task 14) is the only enforcement.
- [ ] Tests: lint failure → exit 2 with linter text; no lint config → exit 0; `lastEditAt` updated; SubagentStop blocks when last proof older than last edit, allows when `stop_hook_active: true`. Commit `feat(hooks): lint-on-edit and proof-before-stop`.

### Task 10: Release gate hook (H7)

**Files:**
- Create: `hooks/release-gate.js`, extend `lib/guards.js`
- Test: `test/hooks-release.test.js`

**Interfaces:**
- `guards.decideRelease({toolName, toolInput, state, slug, approvedChanges}) -> {decision:'allow'|'ask'|'deny', reason}`; env from tool name: `/deploy[-_]?(dev|staging|prod)/i`. dev → allow; staging → ask `Staging release of <version>: confirm`; prod → deny unless gates `review` and `release` approved **and** `approvedChanges` (from `release/approved-changes.json` in main root, `[{ticket, version}]`) contains `{ticket: toolInput.ticket, version: toolInput.version}`; deny reason states the route: `Production needs an approved change ticket for <version> in release/approved-changes.json (release manager).` Unknown env → ask.
- [ ] Tests for each branch; matcher in Task 11 is `mcp__.*deploy.*__release`. Commit `feat(hooks): tiered release gate`.

### Task 11: hooks.json and human-only commands

**Files:**
- Create: `hooks/hooks.json`, `commands/approve.md`, `commands/reject.md`, `commands/reopen.md`
- Modify: `test/structure.test.js`

- [ ] **Step 1: Failing structure tests:** every `command` in hooks.json points to an existing file under `hooks/`; events/matchers are exactly: SessionStart → session-start; PreToolUse `Bash` → approval-guard; PreToolUse `Edit|Write|MultiEdit|NotebookEdit|Read` → pre-write; PostToolUse `Edit|Write|MultiEdit` → post-edit; SubagentStop → subagent-stop (unless Task 2 dropped it); PreToolUse `mcp__.*deploy.*__release` → release-gate; (UserPromptSubmit → approval-prompt if fallback). `approve.md`, `reject.md`, `reopen.md` have `disable-model-invocation: true`.
- [ ] **Step 2:** Write hooks.json and the three commands per Task 2's chosen path. `!`-path body: ``!`node "${CLAUDE_PLUGIN_ROOT}/bin/playbook.js" approve $ARGUMENTS` `` then one sentence: "Tell the user the result above. If it says approved, continue with /mint-playbook:playbook." (reject/reopen analogous).
- [ ] **Step 3:** `npm test` PASS; `claude plugin validate D:\mint-playbook` passes. Commit `feat: wire hooks and human-only gate commands`.

### Task 12: Document chain — orchestrator, intent, spec, plan, tasks

**Files:**
- Create: `skills/playbook/SKILL.md`, `skills/capture-intent/{SKILL.md,templates/intent.md}`, `skills/write-spec/{SKILL.md,templates/spec.md}`, `skills/plan-mode/{SKILL.md,templates/plan.md}`, `skills/split-tasks/{SKILL.md,templates/tasks.md}`
- Create: `agents/{intent-analyst,spec-architect,planner,task-splitter}.md`
- Create: `commands/{playbook,intent,spec,plan,tasks,status}.md`
- Modify: `test/structure.test.js`

**Content requirements (from spec 7.3, 7.4, 9):**
- `playbook` skill: on entry, if no state → ask for the idea (or use `$ARGUMENTS`), derive slug, run `playbook.js init`; then loop on `playbook.js next --json` and run the skill for the action; at `await-approval`, show the approval pack (doc path, 3–5 bullet summary, open questions, exact `/mint-playbook:approve <gate>` and `/mint-playbook:reject <gate> "<reason>"`) and **stop**. At `rework`, read the reason and revise. Always: one question per message.
- `capture-intent`: brainstorm one question at a time until problem, outcome, users/systems, constraints are concrete; pass Q&A to `intent-analyst`; template sections exactly as spec 9; commit; `playbook.js request intent`.
- `write-spec`: discovery pass for existing code ("Current state"); stack choice only for new projects; R1..Rn; constraint→control table; Areas of concern with owners; flag policy-skill clashes; via `spec-architect`; ask user about concerns that need them; request `spec`.
- `plan-mode`: Files that change / Order of work citing R-ids / Risks citing concerns / Proof; interrogation questions; "engineer who has never seen the conversation" bar; request `plan`.
- `split-tasks`: rules from spec 7.4 verbatim as a checklist; also run `/mint-playbook:bootstrap` proposals into `bootstrap/` and add `T0` (kind `bootstrap`); run `playbook.js tasks validate` until clean; request `tasks`.
- Agents per spec 7.8 table (tools exact).
- [ ] **Step 1:** Extend structure test: these skills/agents/commands exist; every template under `skills/*/templates/*.md` contains the section headings listed in spec 9 for its kind (e.g. intent: `## Problem`, `## Proposed outcome`, `## Affected users and systems`, `## Constraints`, `## Open questions`); `skills/split-tasks/templates/tasks.md` parses with `tasks.parse` with zero errors.
- [ ] **Step 2:** FAIL. **Step 3:** Write files. **Step 4:** PASS. **Step 5:** Commit `feat: intent→spec→plan→tasks document chain`.

### Task 13: Bootstrap — CLAUDE.md, policy skills, feedback loop

**Files:**
- Create: `skills/claude-md/{SKILL.md,templates/CLAUDE.md}`, `skills/policy-skills/{SKILL.md,templates/SKILL.md}`, `skills/feedback-loop/SKILL.md`, `skills/pr-review/templates/REVIEW.md`, `skills/claude-md/templates/{.gitattributes,managed-settings.example.json}`, `commands/bootstrap.md`
- Modify: `test/structure.test.js`

- Content: CLAUDE.md template with Commands / Conventions / Architecture / Things Claude gets wrong + the two verification sentences verbatim; claude-md skill writes proposals into `docs/playbook/<slug>/bootstrap/`, merging with an existing CLAUDE.md (show diff, never overwrite); also asks for/derives `setup`, `test`, `lint`, `format` and writes them via `playbook.js config set <key> <value>` (add this tiny CLI command here, with a test). policy-skills: when to write a skill vs CLAUDE.md, the "advisory control" rule. feedback-loop: single target, failing-test-first with `playbook.js task lock-tests`, UI 2–3 screenshot rounds. REVIEW.md per spec 9. Managed-settings example per spec 9 keys.
- [ ] Tests: CLAUDE.md template contains `If a test fails, fix the code, not the test.`; managed-settings example parses as JSON and has `permissions.deny` containing `Read(.env*)`; `config set` test. Commit `feat: bootstrap templates and policy/feedback skills`.

### Task 14: Parallel orchestrator — run-tasks, builder, verifier

**Files:**
- Create: `skills/run-tasks/SKILL.md`, `agents/builder.md`, `agents/verifier.md`, `commands/{build,verify}.md`
- Modify: `test/structure.test.js`

- Content: spec 7.5 steps 1–8 as the skill's procedure, using exactly these CLI calls: `suite baseline`, `waves --next --json`, `task set <id> dispatched`, `task check <id>`, `task set <id> done|failed --branch --sha`, `suite check`, `progress`. Dispatch all of a wave's builders in **one message** with `isolation: "worktree"`. Builder prompt template embedded in the skill: task YAML, spec/plan excerpts, rules (a)–(f) from spec 7.5 with `node "<plugin root>/bin/playbook.js" task start <id>` and `... proof`; "Do not edit tasks.md, plan.md or anything under .playbook". Merge procedure: `git merge --no-ff <branch>`; conflict → `git merge --abort`; `suite check` fails → `git reset --hard ORIG_HEAD`; verifier changes → `git checkout -- . && git clean -fd` then flag. Worktree cleanup with one retry. Retry/stop rule. At start: create/checkout `playbook/<slug>`, add Agent worktree dir to `.git/info/exclude`, refuse on dirty tree (ask user). Fix tasks from review (`extraTasks`) run through the same loop.
- builder agent: tools `Read, Write, Edit, Bash, Glob, Grep`. verifier agent: tools `Bash, Read, Glob, Grep`, body ends "Do not fix anything."
- [ ] Tests: structure (exists; skill mentions `isolation: "worktree"`, `git merge --abort`, `ORIG_HEAD`, `suite check`); verifier tools exact. Commit `feat: parallel wave orchestrator with builder and verifier agents`.

### Task 15: Review, release and PR

**Files:**
- Create: `skills/pr-review/SKILL.md`, `skills/pr-review/templates/workflows/{claude-review.yml,policy-check.yml}`, `agents/{reviewer,security-reviewer}.md`, `skills/release-gate/{SKILL.md,templates/.mcp.json,templates/approved-changes.json}`, `commands/{review,release}.md`

- Content: pr-review skill runs reviewer + security-reviewer in parallel on `git diff <base>...playbook/<slug>` plus `suite check` output (agents have no Bash); writes `review-report.md` (Important vs Nit, ≤5 nits, mapped to R-ids); Important findings → `playbook.js task add F<n> ...` and back to run-tasks before `request review`. release skill: write `release-notes.md`, `request release`; after approval: if `git remote` and `gh auth status` ok → `git push -u origin playbook/<slug>` and `gh pr create --base <base> --head playbook/<slug> --title <title> --body-file release-notes.md`; else report the local branch. Workflow templates: claude-code-action on `pull_request` with REVIEW.md; policy-check on `pull_request` running the project's policy scripts. `.mcp.json` per spec 9 (deploy-dev/staging/prod, `Authorization: Bearer ${DEPLOY_*_TOKEN}`).
- [ ] Tests: structure; `.mcp.json` and `approved-changes.json` parse; workflows contain `on:` `pull_request`. Commit `feat: review, release and PR flow`.

### Task 16: Evals

**Files:**
- Create: `skills/evals/SKILL.md`, `skills/evals/templates/evals/{example-eval.json,run-evals.js,check.js}`, `skills/evals/templates/workflows/evals.yml`
- Test: `test/evals.test.js`

**Interfaces:**
- `check.js` exports `outsideMayChange(changedFiles, mayChange) -> string[]` (uses the same glob algorithm, inlined — templates must be standalone), `formatResult(name, passed, total) -> 'PASS name (5/5 checks)' | 'FAIL name (4/5 checks)'`.
- `run-evals.js`: for each `evals/*.json` → `git worktree add` temp at `from`; copy `CLAUDE.md` and `.claude/` under test; `claude -p <prompt> --allowedTools <eval.allowedTools || "Read,Edit,Bash(make test)"> --output-format json` (never `--bare`); `git diff --name-only` → `outsideMayChange` → fail if non-empty; run each `checks[].run`; print results and `N eval(s) failed`; exit 1 on any fail; remove worktree.
- [ ] Tests on `outsideMayChange` and `formatResult`; example eval JSON has fields `name, source, from, prompt, may_change, checks`; workflow triggers on paths `CLAUDE.md`, `.claude/**`, `evals/**` and a `schedule`. Commit `feat: continuous evals templates`.

### Task 17: Maintain — close the loop

**Files:**
- Create: `skills/close-the-loop/{SKILL.md,templates/bands.yaml,templates/detect-bands.js,templates/workflows/bands.yml}`, `agents/incident-analyst.md`, `commands/maintain.md`
- Test: `test/bands.test.js`

**Interfaces:**
- `detect-bands.js` exports `stats(values) -> {mean, sd}`, `evaluate(history, recent) -> {tier: null|'1sigma'|'2sigma'|'3sigma', rule}` with Western Electric rules: 1 point beyond 3σ → `3sigma`; 2 of 3 beyond 2σ same side → `2sigma`; 4 of 5 beyond 1σ same side → `1sigma`; 8 consecutive same side of mean → `1sigma`. CLI: `node detect-bands.js bands.yaml metrics.json` (metrics `{metric:[{t, v}]}`; baseline = last 30 days of hourly points before the recent window) prints JSON findings with the tier's `action` from bands.yaml.
- Skill: per tier — log; diagnose read-only via incident-analyst; propose: `playbook.js feature new <slug>` + draft intent.md + `request intent` (stops at gate). Triage fix now / schedule / dismiss; each shipped fix adds an eval.
- [ ] Tests: each rule fires on a constructed series; a flat series gives `null`; the spec's worked example (mean 0.2%, reading 1.9%, sd 0.3%) → `3sigma`. Commit `feat: control-band maintain loop`.

### Task 18: Status-line mod

Load the `plugin-authoring` skill first and follow its mod conventions where they differ from below.

**Files:**
- Create: `statusline/statusline.js`, `commands/statusline.md`
- Test: `test/statusline.test.js`

- `statusline.js` exports `render(state, slug) -> string`: `▶ <slug> · <stage> · gate:<gate>(<status>) · tasks <done>/<total>`; reads stdin JSON, uses `workspace.current_dir || cwd` to find state; prints nothing when no state; never throws.
- Command: shows the `statusLine` setting `{"type":"command","command":"node \"<abs plugin path>/statusline/statusline.js\""}`, asks before writing to `~/.claude/settings.json`, refuses to overwrite an existing statusLine without explicit consent.
- [ ] Tests: render output for a mid-build state; empty output without state. Commit `feat: playbook status line`.

### Task 19: README, CI, validation and smoke run

**Files:**
- Create: `README.md`, `.github/workflows/test.yml`

- README: install (`/plugin marketplace add D:\mint-playbook` then `/plugin install mint-playbook@mint-playbook`), quick start (`/mint-playbook:playbook "your idea"`), stage/gate map, command list, hooks table with **enforcement strength** paragraph (honest-agent; hard enforcement via managed settings + branch protection), config keys, Windows notes.
- CI: `node --test` on `windows-latest` and `ubuntu-latest`, Node 18 and 20.
- [ ] **Step 1:** `npm test` → all pass; `claude plugin validate D:\mint-playbook` → valid.
- [ ] **Step 2: Smoke run** in a fresh scratch repo: `/mint-playbook:playbook "a CLI that converts CSV to JSON"`; walk through approvals to `tasks`; confirm a main-session `src/` write is denied before and after the tasks gate; run build with concurrency 2 and observe two builders in parallel; finish with a local branch (no remote). Record observed problems; fix them in this task or file them in README "Known limitations".
- [ ] **Step 3:** Commit `docs: README, CI and smoke-test results`.
