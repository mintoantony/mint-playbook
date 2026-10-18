---
name: release-gate
description: Finishes a playbook feature - writes release-notes.md, requests the release gate, and only after the human approves it pushes playbook/<slug> and opens a pull request with gh (or reports the local branch when there is no remote or gh login). Also explains the deploy release-gate hook, .mcp.json and approved-changes.json templates. Use when the playbook's next action is write-release, or when the user runs /release.
---

# Release gate

You write the release notes, request the `release` gate and stop. The push and the pull request are outward-facing, so they happen only after the human approved the gate. You never approve it.

This skill's base directory is shown when it loads. Run the CLI as `node "<skill base dir>/../../bin/playbook.js" <args>`; below, `playbook.js <args>` means that command. Run everything from the project root. Templates are in `<skill base dir>/templates/`.

## 1. Orient

1. Run `playbook.js next --json`. Note `feature` (the slug). `action` must be `write-release`, or `done` when the release gate is already approved (go to section 3). Anything else: tell the user what `next` says, run the `mint-playbook:playbook` skill and stop. A `playbook: ...` error: show it and stop.
2. The current branch must be `playbook/<slug>`, with a clean `git status --porcelain`. Otherwise tell the user and stop.
3. Base branch: run `git config --get branch.playbook/<slug>.playbookBase`. When unset, do as step 1.3 of the `mint-playbook:pr-review` skill does (origin/HEAD, main, master, never `HEAD`; confirm once and save it with `git config branch.playbook/<slug>.playbookBase <name>`). Call it `<base>`.

## 2. Write release-notes.md and request the gate

Read `intent.md`, `spec.md`, `review-report.md` and `git log --oneline <base>..playbook/<slug>`. Write `docs/playbook/<slug>/release-notes.md`:

```
# <feature title>

## Summary
<two or three sentences: the problem and what changed>

## Changes
- <user-visible change> (R<n>)

## Review
<counts from review-report.md; remaining nits the human accepted>

## Test evidence
<suite result line and the proof commands that passed>

## Deploy and rollback
<how it is released, the one rehearsed rollback command, any change ticket needed>
```

The file doubles as the pull request body, so write it for a reviewer who has not seen the playbook. Commit it: `git add docs/playbook/<slug>/release-notes.md && git commit -m "docs(<slug>): release notes"`. Then run `playbook.js request release` and **stop**.

Tell the user the notes are at `docs/playbook/<slug>/release-notes.md` and that they approve with `/mint-playbook:approve release` or send it back with `/mint-playbook:reject release "<reason>"`. You do not run approve or reject. Say that after approval you can push the branch and open the pull request: run `/mint-playbook:release` again.

## 3. After approval: push and open the PR

Only when `playbook.js status --json` shows the `release` gate `approved`. Otherwise stop as in section 2.

1. `git remote get-url origin`: non-zero means there is no `origin` remote.
2. `gh auth status`: non-zero means gh is missing or not logged in.
3. Both fine: run `gh pr view playbook/<slug> --json url`. When a PR exists, report its URL; if the local branch is ahead of `origin/playbook/<slug>`, ask once and run only `git push`; do not create a second PR. Otherwise ask the user one question, "Push `playbook/<slug>` to `origin` and open a pull request against `<base>`?", with yes recommended. On yes:
   ```
   git push -u origin playbook/<slug>
   gh pr create --base <base> --head playbook/<slug> --title '<feature title>' --body-file docs/playbook/<slug>/release-notes.md
   ```
   The title is free text in a shell line: single-quote it and escape an embedded single quote as `'\''`. Report the PR URL `gh` prints.
4. Either check failed, or the user said no: do not push. Report that the work is on the local branch `playbook/<slug>` (commits ahead of `<base>`), say which check failed and how to fix it (`git remote add origin <url>`, `gh auth login`), and that the user can push later.

Never push to `<base>`, never force push, never merge the PR. Code-owner approval on the PR is still required.

## 4. Deploy gate (reference)

The plugin's hook H7 matches tool names `mcp__.*deploy.*__release`. The environment comes from the server name: `deploy-dev` is allowed, `deploy-staging` asks the user, `deploy-prod` is denied unless the `review` and `release` gates are approved and `release/approved-changes.json` holds an entry whose `ticket` is non-empty and whose `ticket` and `version` match the call. Any other deploy server (no dev, staging or prod in its name) gets `ask`. The agent may act up to the production gate and cannot pass it.

Two copy-in templates are offered when the project wants this:

- `templates/.mcp.json`: deploy-dev, deploy-staging and deploy-prod HTTP servers, bearer tokens from `DEPLOY_DEV_TOKEN`, `DEPLOY_STAGING_TOKEN`, `DEPLOY_PROD_TOKEN`. Replace the example URLs. The plugin does not load it by itself; the user copies it to the project root.
- `templates/approved-changes.json`: copy to `release/approved-changes.json`. It ships as `[]`; each entry has the shape `{ "ticket": "CHG-123", "version": "1.4.0" }` (both non-empty strings, matched against the release call). Only the release manager adds entries; the agent never edits this file.

Rollback must be a single command the team has rehearsed; put it in the release notes.
