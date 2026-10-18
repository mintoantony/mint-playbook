# Review rules

Review the diff in three passes. Compare against `docs/playbook/<slug>/spec.md` and `plan.md` when they exist.

## Passes

1. **Bugs and logic.** Wrong behaviour, unhandled errors, off-by-one, races, missing tests for changed behaviour.
2. **Security.** Secrets in code or logs, injection, missing authorisation, unsafe deserialisation, new dependencies.
3. **Compliance.** Does the change do what spec.md requires, stay inside plan.md, and follow CLAUDE.md and the project's policy skills?

## Severity

- **Important**: only for findings that break behaviour, leak data or breach policy. Each needs file, line, and why.
- **Nit**: everything else. At most five nits; drop the rest.

## Authority

- Findings do not approve or block a change on their own. Code-owner approval is still required.
- The agent that wrote the code cannot approve its own code.
- When a comment says `@claude`, fix the point raised and push.
