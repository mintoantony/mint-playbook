---
description: Human-only: reject a playbook gate with a reason so the work is reworked
argument-hint: <gate> "<reason>"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/playbook.js" reject $ARGUMENTS`

Tell the user the result above. If it says rejected, run the `mint-playbook:playbook` skill to continue: it reworks the gate using the reason.
Put the reason in double quotes, and avoid $ and backticks in it.
