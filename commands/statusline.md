---
description: Show playbook progress (feature, stage, gate, tasks) in the Claude Code status line
---

Set up the playbook status line. It shows `▶ <feature> · <stage> · gate:<gate>(<status>) · tasks <done>/<total>` and nothing outside a playbook project.

1. Work out the absolute path of this plugin: `${CLAUDE_PLUGIN_ROOT}`. Use forward slashes in it, also on Windows. The setting to add is exactly:

```json
{"statusLine":{"type":"command","command":"node \"${CLAUDE_PLUGIN_ROOT}/statusline/statusline.js\""}}
```

2. Read `~/.claude/settings.json` (it may not exist yet). If it already has a `statusLine`, show the user the existing value and do NOT overwrite it unless they explicitly agree to replace it. If they decline, stop.
3. Show the user the setting and ask for permission before writing anything to `~/.claude/settings.json`. Do not write without a clear yes.
4. On yes, read the file as JSON, set only the `statusLine` key, and write it back. Keep every other setting unchanged. If the file exists but is not valid JSON, stop and tell the user rather than overwriting it.
5. Tell the user the status line appears on the next Claude Code refresh or restart, and that removing the `statusLine` key turns it off.
