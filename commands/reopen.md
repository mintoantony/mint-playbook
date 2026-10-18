---
description: Human-only: reopen an approved playbook gate so it can be revised
argument-hint: <gate>
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/playbook.js" reopen $ARGUMENTS`

Tell the user the result above. If it says reopened, continue with /mint-playbook:playbook.
