---
description: Show where the active playbook feature stands and what comes next
argument-hint: [feature slug]
---

Run `node "${CLAUDE_PLUGIN_ROOT}/bin/playbook.js" status` and `node "${CLAUDE_PLUGIN_ROOT}/bin/playbook.js" next` (add `--feature <slug>` to both when this is not empty: $ARGUMENTS), then summarise in a few lines: feature, gate states, task counts, and the next step. `stage` is the course stage (plan, design, build, deploy, maintain); the intent gate belongs to the plan stage. If it reports the project is not initialised, suggest `/mint-playbook:playbook "<idea>"`.
