---
name: run-tasks
description: Builds a playbook feature from its approved tasks.md in parallel waves - one builder agent per task in its own git worktree, serial merges into playbook/<slug> checked against the test baseline, a verifier after each wave, retries and progress commits. Use when the playbook's next action is build, when review added fix tasks, when a build was interrupted and must resume, or when the user runs /build.
---

# Run tasks

You are the orchestrator. You never write source code: builders do, each in its own worktree. You pick the next wave, dispatch the builders in parallel, merge their branches one at a time into `playbook/<slug>`, check the suite against the baseline after each merge, have a verifier check the wave, and record progress.

This skill's base directory is shown when it loads. The CLI is `<skill base dir>/../../bin/playbook.js`. Resolve that to an absolute path once (`CLI` below) and run it as `node "<CLI>" <args>`; below, `playbook.js <args>` means that command. Run everything from the project root. Builders and the verifier cannot see this skill's base directory, so every prompt you send them carries `CLI` as an absolute path.

## Rules for the whole run

- **You only run git and the CLI.** A hook lets the main session edit only `docs/playbook/**`, and the CLI writes `progress.md` itself. Never edit source files, `tasks.md`, `plan.md` or `.playbook/` to make a merge or a test pass. When something needs a code change, it goes to a builder (a retry) or to the user.
- **One question per message** when you must ask the user. Prefer multiple choice with your recommendation marked.
- **Never touch the base branch.** All merges go into `playbook/<slug>`. Push and pull request come after the `release` gate, not here.
- Keep a short note per task as you go: branch, worktree path, commit SHA, and the last failure output. Retries and the stop message need it.

## 1. Preconditions (once per run)

1. Run `playbook.js next --json`. Note `feature` (the slug).
   - `action` is `build`: continue.
   - Anything else: tell the user what `next` says and run the `mint-playbook:playbook` skill, which handles it. Stop here.
   - A `playbook: ...` error: show it and run the `mint-playbook:playbook` skill. Stop here.
2. If `git rev-parse -q --verify MERGE_HEAD` prints a SHA and the current branch is `playbook/<slug>`, a merge from an interrupted run is open: run `git merge --abort`.
3. Run `git status --porcelain`. If it prints anything, stop and ask the user to commit or stash those changes, listing them. Worktrees fork from the current commit, so the tree must be clean. Do not commit or stash for them.
4. Branch: if `git branch --show-current` is not `playbook/<slug>`, run `git switch playbook/<slug>` when the branch exists (`git rev-parse -q --verify refs/heads/playbook/<slug>`), otherwise `git switch -c playbook/<slug>`. It branches from where the user is, which already holds the approved documents.
5. Agent worktrees live in `.claude/worktrees/`. Run `git rev-parse --git-path info/exclude` and, if that file does not contain the line `.claude/worktrees/`, append it with Bash: `printf '%s\n' '.claude/worktrees/' >> "<that path>"`. This keeps the main checkout clean while builders work.
6. Commands: run `playbook.js config get test`. If it prints `null`, find the test command the way step 2 ("Commands") of the `mint-playbook:claude-md` skill does (`package.json` scripts, `Makefile`, CI workflows, `README.md`), then ask the user one question: "Which single command runs the whole test suite and exits non-zero on failure? I found: `<command>`". Store the answer with `playbook.js config set test "<command>"`. Then run `playbook.js config get setup`; when it is not `null`, run it once here so the main checkout can run the suite.
7. Baseline: run `playbook.js status --json`. When `baseline` is `null`, run `playbook.js suite baseline`. It records which tests already fail, so a merge counts as red only when it adds failures. Tell the user the result line in one sentence.
8. Read `docs/playbook/<slug>/tasks.md` (task sections and the yaml task list), `spec.md` and `plan.md`, and `extraTasks` from `playbook.js status --json` (fix tasks added by review). These are the task definitions for the prompts and for working out dependents.

## 2. Resume

Run `playbook.js status --json` and look at `tasks`. For each task with status `dispatched` or `in-progress`:

1. Run `git worktree list --porcelain`. The task is alive when its recorded `worktree` is listed and `git rev-list --count HEAD..<branch>` (its recorded `branch`) prints 1 or more.
2. Alive: treat it as a builder result (section 3, step 4, from the `task check` line on) and merge it with the wave (steps 5 to 9).
3. Not alive: run `playbook.js task set <id> todo`. If its worktree is still listed, remove it and its branch as in step 6.

Then list worktrees under `.claude/worktrees/` that belong to no task. Remove each whose branch has no commits beyond `HEAD` (`git rev-list --count HEAD..<branch>` prints 0). Name any others to the user once and leave them.

## 3. The wave loop

Number the waves from 1 in this run. Repeat:

### Step 1. Pick

Run `playbook.js waves --next --json`. It prints a JSON array of task ids whose dependencies are all `done`, capped at the configured concurrency (default 3). Failed tasks with fewer than two attempts come back here: that is the automatic retry.

- `[]`: go to section 4.
- Otherwise these ids are the wave.

### Step 2. Prepare

Record the wave's start: `git rev-parse HEAD` (`WAVE_START`). For each task, fill the builder prompt (section 5) with:

- its yaml entry from `tasks.md` (or from `extraTasks`), copied verbatim;
- its prose section from `tasks.md`;
- each requirement in `covers`, copied from `spec.md` with its text;
- the "Order of work" lines of `plan.md` that cite those requirements or name its files;
- `PLAYBOOK_PORT_OFFSET`: its index in the wave × 10 (0, 10, 20, ...);
- for `T0` (`kind: bootstrap`): the absolute path of `docs/playbook/<slug>/bootstrap/`;
- for a retry: the full failure output you noted (builder report, conflict list, suite output or verifier findings).

### Step 3. Dispatch

1. Run `playbook.js task set <id> dispatched` for every task in the wave.
2. Send **one message** with one Agent call per task, all together, so the builders run in parallel:
   - `subagent_type: "mint-playbook:builder"`
   - `isolation: "worktree"`
   - `description`: `Build <id>`
   - `prompt`: the filled builder prompt
3. Wait until every builder of the wave has reported.

### Step 4. Collect

For each builder result:

1. Take the worktree path and branch from the Agent result's worktree note (`.claude/worktrees/agent-<id>`, branch `worktree-agent-<id>`); fall back to the `Worktree:` and `Branch:` lines of the builder's report. No worktree kept means the builder changed nothing: the task failed ("builder did not commit").
2. `git rev-list --count HEAD..<branch>` prints 0: failed ("builder did not commit").
3. `git -C "<worktree>" status --porcelain` prints anything: failed ("uncommitted changes in the worktree: <list>"); the proof ran on files the commit does not hold.
4. Run `playbook.js task check <id>`. It reads the worktree's active task and confirms the last proof passed after the last edit. Exit 1: failed, with its message.
5. Otherwise the task is ready to merge. Note its SHA: `git rev-parse <branch>`.

A failed task: note the failure output (with the builder's report) and record it now with `playbook.js task set <id> failed --branch <branch> --worktree <worktree>` (add `--sha <sha>` when there is a commit). Then do step 8's dependents rule for it.

### Step 5. Merge, one task at a time

Take the ready tasks in task-id order. For each:

1. If the task's `shared` list is not empty, write its globs as union-merge attributes with Bash (`ATTR` is the file `"$(git rev-parse --absolute-git-dir)/playbook-union-attributes"`): `printf '%s merge=union\n' <glob> <glob> ... > "$ATTR"`. Git's union driver keeps both sides' added lines in those files instead of reporting a conflict. Merge with `git -c core.attributesFile="$ATTR" merge --no-ff -m "merge(<slug>): <id> <title>" <branch>`.
   Without `shared`: `git merge --no-ff -m "merge(<slug>): <id> <title>" <branch>`.
2. The merge exits non-zero: list the conflicts with `git diff --name-only --diff-filter=U`, run `git merge --abort`, and the task failed ("merge conflict in <files>").
3. If `git diff --name-only ORIG_HEAD HEAD` lists a manifest or lockfile (`package.json`, `package-lock.json`, `pyproject.toml`, `requirements*.txt`, `go.mod`, `Cargo.toml`, ...), run the setup command first.
4. Run `playbook.js suite check`.
   - `suite: ok`: run `playbook.js task set <id> done --branch <branch> --worktree <worktree> --sha <sha>`. Then any task with status `blocked` whose dependencies are no longer `failed` goes back with `playbook.js task set <dependent> todo`.
   - Anything else (`suite: new failures: ...`): run `git reset --hard ORIG_HEAD`; the task failed, with the suite output.
5. If `git status --porcelain` now prints anything, the suite left files behind: run `git checkout -- . && git clean -fd`, and mention it to the user once.

A task that failed here: `playbook.js task set <id> failed --branch <branch> --worktree <worktree> --sha <sha>`, note the output, and apply step 8's dependents rule.

### Step 6. Clean up

For every task of the wave that had a worktree, done or failed:

1. `git worktree remove --force "<worktree>"`. If it fails (on Windows a file lock is common), wait a few seconds with `node -e "setTimeout(()=>{},5000)"` and run it once more. If it still fails, tell the user the path and continue.
2. `git branch -D <branch>` for a done task. For a failed task, keep the branch only after its second failure, so the user can inspect it; otherwise delete it too.

### Step 7. Verify

When at least one task merged in this wave, dispatch one Agent call:

- `subagent_type: "mint-playbook:verifier"`, no `isolation` (it checks the integration branch in this checkout)
- `description`: `Verify wave <n>`
- `prompt`: the filled verifier prompt (section 6) for the tasks merged in this wave, with `git log --oneline WAVE_START..HEAD` and `git diff --stat WAVE_START..HEAD`.

Afterwards run `git status --porcelain`. If it prints anything, run `git checkout -- . && git clean -fd` and tell the user the verifier left changes and they were discarded.

Show the user the verifier's summary line. When it reports FAIL for any task, show those tasks' findings and ask one question:

- (a) Retry those tasks with the findings (recommended): run `playbook.js task set <id> todo` for each and keep their findings as the failure output for the next dispatch. The builder fixes on top of the merged code.
- (b) Continue with the next wave as is.
- (c) Stop here.

Wait for the answer. On (c), do step 9, then stop.

### Step 8. Failures and dependents

Dependents rule: when a task fails, every task that depends on it, directly or through other tasks, and is still `todo` gets `playbook.js task set <dependent> blocked`.

A failed task with fewer than two attempts (`attempts` in `playbook.js status --json`) is retried automatically: the next `waves --next` returns it, and its prompt carries the failure output. A task that failed its second attempt stops the run after this wave: finish steps 5 to 7 for the rest of the wave, do step 9, then go to section 4's stop message.

### Step 9. Record progress

```
playbook.js progress
git add docs/playbook/<slug>/progress.md && git commit -m "docs(<slug>): progress after wave <n>"
```

Tell the user in one line: wave n, merged ids, failed ids. Then go back to step 1, unless step 7 or step 8 said to stop.

## 4. Finish

When `waves --next --json` prints `[]`, run `playbook.js status --json`.

- **Every task is `done`:** tell the user the build is complete on `playbook/<slug>` (task count, waves, retries). Return to the `mint-playbook:playbook` skill's loop if it sent you here, otherwise run it now; its next action is `write-review`. Fix tasks that review adds (`playbook.js task add`) come back here through `build` and run through the same loop.
- **Otherwise** (tasks `failed` after two attempts, or `blocked`): stop and send one message: each failed task with its last failure output (shortened to the lines that matter) and kept branch, the blocked tasks, and one question:
  - (a) Retry the failed tasks once more (`playbook.js task set <id> todo`, and the blocked ones back to `todo`), then run this loop again.
  - (b) Stop, so you can change the plan or the tasks (`/mint-playbook:reopen tasks`) or fix it by hand.

## 5. Builder prompt

Fill every `<...>`. Paths are absolute.

````
You are building task <id> of the playbook feature "<slug>". Your working directory is your own git worktree on its own branch.

CLI: <CLI>    (run it as node "<CLI>" <args> from your worktree root)
PLAYBOOK_PORT_OFFSET: <n>
Bootstrap folder (T0 only): <absolute path of docs/playbook/<slug>/bootstrap/, or "n/a">

## Task (from tasks.md)
```yaml
<the task's yaml entry, verbatim>
```
<the task's prose section from tasks.md>

## Requirements it covers (from spec.md)
<each covered requirement with its full text>

## Plan (from plan.md, Order of work)
<the relevant lines>

## Previous attempt (retries only)
<the failure output, or "none">

## Rules, in order
a. node "<CLI>" task start <id>
b. Run the setup command (node "<CLI>" config get setup; null means none).
c. Tests first, then code. Edit only files matching owns; append to shared files, never rewrite them. For kind: bugfix, commit the failing test first and lock it with node "<CLI>" task lock-tests <path>.
d. Run the format command (node "<CLI>" config get format) on the files you changed, then the proof: PLAYBOOK_PORT_OFFSET=<n> node "<CLI>" proof. Fix the code until it passes.
e. Commit everything: git add -A && git commit -m "feat(<slug>): <id> <title>".
f. Report your branch, worktree path, commit SHA and the pasted proof output, in your report format.

Do not edit tasks.md, plan.md, spec.md, intent.md or anything under .playbook. If a test fails, fix the code, not the test.
For T0: copy each file from the bootstrap folder to the same path under the worktree root; append the lines of .gitignore.append that .gitignore lacks to .gitignore instead of copying it.
````

## 6. Verifier prompt

````
Verify wave <n> of the playbook feature "<slug>" on branch playbook/<slug>, in this checkout.

CLI: <CLI>    (run it as node "<CLI>" <args> from the project root)

## Tasks merged
<for each: id, title, proof command, and the covered requirements with their text from spec.md>

## Changes
<git log --oneline WAVE_START..HEAD>
<git diff --stat WAVE_START..HEAD>

Run the tests and the app per the config, exercise each change and two neighbouring flows, and report PASS or FAIL per task with evidence, in your report format. Do not fix anything.
````
