---
description: Human-only: reject a playbook gate with a reason so the work is reworked
argument-hint: <gate> "<reason>"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/playbook.js" reject $ARGUMENTS`

Tell the user the result above. If it says rejected, rework the artifact using the reason, then continue with /mint-playbook:playbook.
Put the reason in double quotes, and avoid $ and backticks in it.
