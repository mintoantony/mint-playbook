---
description: Human-only. Approve a playbook gate after you have reviewed its artifact
argument-hint: <gate>
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/playbook.js" approve $ARGUMENTS`

Tell the user the result above. If it says approved, run the `mint-playbook:playbook` skill to continue with the next step. After the `release` gate, that step pushes the branch and opens the pull request (after one confirmation question).
