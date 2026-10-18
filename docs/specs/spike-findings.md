# Spike findings: harness behaviour (Claude Code CLI 2.1.302)

Method: nested `claude -p ... --plugin-dir D:/mint-playbook` runs in a scratch git repo, with temp hooks dumping stdin JSON. Interactive TTY could not be driven; "human typing the command" is simulated by headless `claude -p "/mint-playbook:spike-approve x"` (slash-command expansion is the user-input path). **Interactive behaviour must be re-checked in Task 19.**

## Findings

1. (1a) User-typed `/mint-playbook:spike-approve x` with `disable-model-invocation: true` + `allowed-tools: Bash(node:*)` runs the command's `!` line: `spike.txt` was created in the cwd (headless simulation; re-check interactively in Task 19).
2. (1b) A PreToolUse `Bash` hook does NOT see the `!` line: after the run, the dump held only a `UserPromptSubmit` entry and no `pre` (PreToolUse) entry. The `!` preprocessing bypasses PreToolUse, so H-hooks cannot gate or observe it.
3. (1c) Model invocation is refused: asked to run `mint-playbook:spike-approve` via the Skill tool, the model got "refused because the skill has `disable-model-invocation` set", `spike.txt` was absent, and `permission_denials` was empty (refusal is at the Skill tool, not a permission denial).
4. (2) `UserPromptSubmit` payload `prompt` holds the raw slash text: `"prompt":"/mint-playbook:spike-approve x"` (also has `session_id`, `cwd`, `prompt_id`, `permission_mode`, `hook_event_name`). So a UserPromptSubmit fallback can match the typed command.
5. (2 caveat) `UserPromptSubmit` ALSO fires for subagent hand-backs, with `prompt` starting `<agent-message from="<agent_id>">\n[Subagent hand-back] ... NOT a message from the user`. A prompt-based approval hook must require the prompt to START with the slash command (anchored match) and ignore `<agent-message` prompts.
6. (3a) Worktree isolation: `Agent` with `isolation: "worktree"` created worktree `<repo>/.claude/worktrees/agent-<agent_id>` on branch `worktree-agent-<agent_id>` (e.g. `agent-a3f149d3b56ba673b`).
7. (3b) Subagent PreToolUse (Write and Bash) payload `cwd` IS the worktree path (`...\spike-repo\.claude\worktrees\agent-a3f149d3b56ba673b`); the main session's `cwd` stays the repo root.
8. (3c) SubagentStop payload `cwd` IS the worktree path; fields: `session_id, cwd, prompt_id, permission_mode, agent_id, agent_type ("general-purpose"), effort, hook_event_name, stop_hook_active (false), agent_transcript_path, background_tasks, session_crons`.
9. (3d) Subagent PreToolUse payloads carry `agent_id` and `agent_type`; main-session payloads (UserPromptSubmit) carry neither. This also lets hooks tell subagent calls from main-session calls.
10. (3e) The parent is told the path and branch: the Agent tool result gave "Worktree path ... Branch: worktree-agent-a3f149d3b56ba673b" and noted the worktree is kept because it has a commit. Commit landed on the worktree branch; `master` unchanged.

## Decisions

approval-path: bang
- `!` preprocessing runs only on user-typed commands (1a) and cannot be invoked by the model (1c); UserPromptSubmit remains a viable fallback (4, 5) but is not needed. Caveat: PreToolUse hooks do not see the `!` line (2), so any enforcement must live in the script itself; confirm interactively in Task 19.

subagentstop: cwd
- SubagentStop and subagent PreToolUse payloads carry `cwd` equal to the worktree path (7, 8), so H8 can key its check off payload `cwd` rather than falling back to orchestrator-only `task check`.
