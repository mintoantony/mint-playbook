---
name: pr-review
description: Runs the review gate for a playbook feature - gathers the branch diff and the suite result into files, runs the reviewer and security-reviewer agents in parallel, writes review-report.md (Important vs Nit, at most five nits, mapped to requirement ids), turns Important findings into fix tasks, and requests the review gate. Use when the playbook's next action is write-review, or when the user runs /review.
---

# PR review

You are the orchestrator of the review gate. Two read-only agents review the branch: `mint-playbook:reviewer` (bugs, logic, compliance with spec.md and plan.md) and `mint-playbook:security-reviewer`. They have no Bash, so you gather the evidence into files and pass the paths. You write `review-report.md` and request the gate. You never approve it.

This skill's base directory is shown when it loads. Run the CLI as `node "<skill base dir>/../../bin/playbook.js" <args>`; below, `playbook.js <args>` means that command. Run everything from the project root.

## 1. Orient

1. Run `playbook.js next --json`. Note `feature` (the slug). `action` must be `write-review`; otherwise tell the user what `next` says, run the `mint-playbook:playbook` skill and stop. A `playbook: ...` error: show it and stop.
2. The current branch must be `playbook/<slug>` (`git branch --show-current`), with a clean `git status --porcelain`. Otherwise tell the user and stop.
3. Base branch: the branch `playbook/<slug>` was cut from. Use, in order: the oldest entry of `git reflog show playbook/<slug>` when it reads `branch: Created from <name>`; `git symbolic-ref --short refs/remotes/origin/HEAD` without the `origin/` prefix; `main`, then `master`, whichever exists. When none is certain, ask the user one question. Call it `<base>`.
4. Run `playbook.js suite check` and keep its full output. Tell the user the result line.

## 2. Gather evidence

Write to the OS temp directory (never into the project):

- `DIFF` = output of `git diff <base>...playbook/<slug>`. When it is empty, tell the user there is nothing to review and stop.
- `SUITE` = the output of step 1.4.

Locate `docs/playbook/<slug>/spec.md`, `plan.md`, the project's `REVIEW.md` and `CLAUDE.md`. When the project has no `REVIEW.md`, use the template at `<skill base dir>/../claude-md/templates/REVIEW.md` and say so; do not create a new template.

## 3. Review in parallel

Send **one message** with two Agent calls, all paths absolute in the prompts:

- `subagent_type: "mint-playbook:reviewer"`, `description`: `Review <slug>`
- `subagent_type: "mint-playbook:security-reviewer"`, `description`: `Security review <slug>`

Each prompt carries: slug, base branch, `DIFF`, `SUITE`, and the paths of spec.md, plan.md, REVIEW.md and CLAUDE.md. Wait for both.

## 4. Write the report

Write `docs/playbook/<slug>/review-report.md` from both reports:

```
# Review report: <title>
Slug: <slug>
Branch: playbook/<slug> against <base>
Suite: <result line>

## Important
- <file>:<line> [R<n>|none] <finding> (reviewer | security)

## Nits
- ... (at most five in total, most useful first)

## Requirement coverage
| Requirement | Covered by | Notes |

## Verdict
<n> Important, <n> Nits. <what the user is asked to decide>
```

Rules: "Important" only for findings that break behaviour, leak data or breach policy; every finding names a file, a line and a requirement id (or `none`); drop nits beyond five; merge duplicates from the two agents. Write "None" under an empty heading.

Commit it: `git add docs/playbook/<slug>/review-report.md && git commit -m "docs(<slug>): review report"`.

## 5. Important findings go back to build

When there is at least one Important finding, do not request the gate. For each, add a fix task:

```
playbook.js task add F<n> --title "<short title>" --owns "<files to change>" --proof "<command that fails now and passes when fixed>" [--depends <ids>]
```

Number F1, F2, ... (skip numbers already used; see `extraTasks` in `playbook.js status --json`). The proof is a real command, normally the project's test command narrowed to a new test. Tell the user the findings and tasks in a few lines, then run the `mint-playbook:run-tasks` skill. When it finishes, review again from step 1 (the report is rewritten against the new diff).

## 6. Request the gate

With no Important findings:

```
playbook.js request review
```

Then **stop**. Tell the user: `review-report.md` is ready at `docs/playbook/<slug>/review-report.md` (with the counts), and that they approve it by running `/mint-playbook:approve review`, or send it back with `/mint-playbook:reject review "<reason>"`. Findings do not approve or block on their own; code-owner approval is still required. You do not run approve or reject.
