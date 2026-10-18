---
name: feedback-loop
description: Gives a builder a verifiable loop for its task: one target command that exits non-zero, a failing test first for bugfix tasks, screenshot comparison rounds for UI work, and the proof output pasted before reporting done. Use when starting any playbook task in a worktree, especially a bugfix or UI task.
---

# Feedback loop

You work against a check that tells you the truth. Without it you are guessing.

This skill's base directory is shown when it loads. Run the CLI as `node "<skill base dir>/../../bin/playbook.js" <args>`; below, `playbook.js <args>` means that command. Run it from your worktree.

## 1. One target

Use a single command that exits non-zero on failure: your task's proof, or the project's test command (`playbook.js config get test`). Run that command after every change. Do not invent a second way to check. If it is slow, run a narrower scope while working and the full target before you finish.

The result must be quantifiable: a failing test, an exit code, a count. "Looks right" is not a result.

## 2. Bugfix tasks (`kind: bugfix`)

1. Write a test that reproduces the bug. Run the target and watch it fail for the right reason.
2. Commit the failing test.
3. Run `playbook.js task lock-tests <path>` for each test file. A hook now denies edits to them.
4. Fix the code until the target passes.

If a test fails, fix the code, not the test. When you believe the test itself is wrong, stop and report that to the caller instead of changing it.

## 3. UI tasks

Compare screenshots against the reference (a mockup, a spec image, or the previous state):

1. Build the change, take a screenshot, compare it with the reference, list the differences.
2. Fix the differences and repeat. Do 2 to 3 rounds, not more.
3. After the last round, say which differences remain and why.

Screenshots supplement the target command; they do not replace it.

## 4. Before you report done

Run `playbook.js proof` and paste its full output into your report. Do not report done without it, and do not summarise the output in its place. If it fails, you are not done: fix the code and run it again.

A `playbook: ...` error from the CLI (for example no active task in this worktree): show it in your report and stop.
