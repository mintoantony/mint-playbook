---
description: Write release-notes.md for the playbook feature, request the release gate and, once the human approves it, push the branch and open the pull request
argument-hint: [feature slug]
---

Use the mint-playbook:release-gate skill. Feature slug from the user (may be empty): $ARGUMENTS. When it is not empty, run `node "${CLAUDE_PLUGIN_ROOT}/bin/playbook.js" feature use <slug>` before the skill's first step.
