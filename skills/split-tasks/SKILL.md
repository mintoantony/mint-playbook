---
name: split-tasks
description: Splits the approved plan into independent tasks in docs/playbook/<slug>/tasks.md (file ownership, dependencies, a runnable proof per task, T0 bootstrap), proposes bootstrap files, runs tasks validate until clean, and requests the tasks gate. Use when the playbook's next action is split-tasks, when the tasks gate was rejected, or when the user runs /tasks.
---

# Split tasks

Tasks run in parallel in separate worktrees, so independence is the goal: each task owns its files, names its dependencies and carries its own proof. The `task-splitter` agent drafts; you validate in the main session.

This skill's base directory is shown when it loads. Run the CLI as `node "<skill base dir>/../../bin/playbook.js" <args>`; below, `playbook.js <args>` means that command.

## Splitting checklist

Every rule holds for the finished `tasks.md`:

- [ ] Every R is covered.
- [ ] `T0` = bootstrap.
- [ ] A foundation task owns skeleton, shared types, config, manifests and lockfiles — any new dependency goes through it.
- [ ] `owns` must include the task's test globs.
- [ ] Two tasks may not own overlapping globs unless one depends on the other.
- [ ] Files several tasks must append to go in `shared`.
- [ ] Each task has a runnable proof.
- [ ] Prefer more smaller tasks over long chains.

## 1. Orient

1. Run `playbook.js next --json`. Note `feature` (the slug) and `doc` (`docs/playbook/<slug>/tasks.md`).
   - `action` is `split-tasks`, or `rework` with `gate` `tasks`: continue.
   - `await-approval` for `tasks`: go to step 7.
   - An earlier gate is not approved: tell the user which, and stop.
   - A later gate: tasks is approved and locked. Changing it needs `/mint-playbook:reopen tasks`. Stop.
   - `next` fails with a `playbook: ...` error: show the error to the user and run the `mint-playbook:playbook` skill, which handles it. Stop here.
2. Read `spec.md` and `plan.md` in `docs/playbook/<slug>/`. If `doc` exists, read it: this is a revision, and `reason` (if any) says what to change.

## 2. Bootstrap proposals

Run the `mint-playbook:claude-md` skill. It drafts the bootstrap proposals (CLAUDE.md, REVIEW.md, `.gitattributes`, evals, CI workflows) into `docs/playbook/<slug>/bootstrap/`, merging with any existing project files, and records the project's setup and test commands. It asks the user its own questions, one at a time.

When it finishes, list the files in `bootstrap/`. Each maps to a project-root path (`bootstrap/CLAUDE.md` → `CLAUDE.md`, `bootstrap/evals/...` → `evals/...`, `bootstrap/.github/workflows/x.yml` → `.github/workflows/x.yml`), except `bootstrap/.gitignore.append`, which maps to `.gitignore`: T0 appends its lines there, so T0 owns `.gitignore`, never `.gitignore.append`. These root paths are what `T0` owns. When the user declined every proposal, `T0` owns nothing and its proof is `node -e "process.exit(0)"`.

## 3. Draft

Dispatch the `mint-playbook:task-splitter` agent. Its prompt contains:

- the absolute paths of `spec.md` and `plan.md`
- the splitting checklist above, word for word
- the bootstrap files and the root paths `T0` will own
- the project's test command (from the plan's Proof)
- the template path: `<skill base dir>/templates/tasks.md`, as an absolute path
- the output path: the absolute path of `doc`
- in a revision: the current document is at the output path, plus the reason

## 4. Validate

Run `playbook.js tasks validate`.

- `tasks: ok (...)`: go to step 5. In a revision after a reopen, lines like `task T3: definition changed; reset to todo (was done)` mean a task's title, owns, shared, depends_on or proof changed, so its earlier build no longer counts and it runs again. Tell the user which tasks were reset to todo.
- Errors print as `tasks.md:<line>: <problem>` or `tasks.md: <problem>`. Fix each one with Edit, or dispatch the agent again with the error lines. Run `tasks validate` again. Repeat until it prints `tasks: ok`.

## 5. Check what the validator cannot

Run `playbook.js waves` and read `tasks.md` against the checklist:

- `T0` has `kind: bootstrap`, `depends_on: []`, owns exactly the root paths from step 2 (`.gitignore`, not `.gitignore.append`), and its proof checks they exist, e.g. `node -e "process.exit(require('fs').existsSync('CLAUDE.md')?0:1)"`.
- One foundation task owns skeleton, shared types, config, manifests and lockfiles; any new dependency goes through the foundation task.
- Append-only files (route tables, index exports) sit in `shared`, never in `owns`.
- Each proof is a single command that runs from the project root on Windows, macOS and Linux (`npm test -- <path>`, `node ...`), scoped to the task's tests.
- `kind` is `feature`, or `bugfix` for a task that fixes a bug (its failing test is written and committed first).
- Waves: when most waves hold a single task, the split is a chain. Look for tasks to split or dependencies to drop, then validate again.
- The prose section for each task matches its entry in the task list.

## 6. Commit and request

Leave `bootstrap` out of `git add` when the folder does not exist.

```
git add docs/playbook/<slug>/tasks.md docs/playbook/<slug>/bootstrap && git commit -m "docs(<slug>): tasks draft"
playbook.js request tasks
```

## 7. Hand back

If the `mint-playbook:playbook` skill sent you here, return to its loop: it shows the approval pack. Otherwise run the `mint-playbook:playbook` skill now; it shows the pack and stops.
