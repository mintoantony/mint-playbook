---
description: Review the playbook feature branch - run reviewer and security-reviewer, write review-report.md, add fix tasks for Important findings and request the review gate
argument-hint: [feature slug]
---

Use the mint-playbook:pr-review skill. Feature slug from the user (may be empty): $ARGUMENTS. When it is not empty, run `node "${CLAUDE_PLUGIN_ROOT}/bin/playbook.js" feature use <slug>` before the skill's first step.
