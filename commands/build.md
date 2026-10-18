---
description: Build the active playbook feature - run its approved tasks in parallel worktree waves, merge, verify and record progress
argument-hint: [feature slug]
---

Use the mint-playbook:run-tasks skill. Feature slug from the user (may be empty): $ARGUMENTS. When it is not empty, run `node "${CLAUDE_PLUGIN_ROOT}/bin/playbook.js" feature use <slug>` before the skill's first step.
