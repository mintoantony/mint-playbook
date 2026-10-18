---
description: Human-only: approve a playbook gate after you have reviewed its artifact
argument-hint: <gate>
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/playbook.js" approve $ARGUMENTS`

Tell the user the result above. If it says approved, continue with /mint-playbook:playbook.
