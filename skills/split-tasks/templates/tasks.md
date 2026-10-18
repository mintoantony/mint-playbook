# Tasks: <feature title>

Author: <name>
Status: Draft
Spec: spec.md
Plan: plan.md

Every task below has a short section for the builder, and an entry in the task list at the end.
The task list is what `playbook.js tasks validate` and `playbook.js waves` read. Keep the two in step.
Task status is kept in `.playbook/state.json` during Build, not here.

## T0 — Apply bootstrap files

Apply the approved proposals in `bootstrap/` to the project root. Merge into existing files; never overwrite them.

- Proof: CLAUDE.md exists at the project root.

## T1 — Foundation: <skeleton, shared types, config, manifests>

<What the builder creates. This task owns the manifests and lockfiles, so every new dependency is added here.>

- Covers: R1
- Proof: <command>

## T2 — <feature slice>

<What the builder creates, which files, which behaviour from the spec, and the test that proves it.>

- Covers: R2
- Depends on: T1
- Proof: <command>

## Task list

```yaml
- id: T0
  title: Apply bootstrap files
  covers: []
  depends_on: []
  owns: ["CLAUDE.md", "REVIEW.md", ".gitattributes", ".gitignore", "evals/**", ".github/workflows/**"]
  shared: []
  proof: "node -e \"process.exit(require('fs').existsSync('CLAUDE.md')?0:1)\""
  kind: bootstrap
- id: T1
  title: Foundation - skeleton, shared types, config, manifests
  covers: [R1]
  depends_on: [T0]
  owns: ["package.json", "package-lock.json", "src/types/**", "test/types/**"]
  shared: []
  proof: "npm test -- test/types"
  kind: feature
- id: T2
  title: <feature slice>
  covers: [R2]
  depends_on: [T1]
  owns: ["src/feature/**", "test/feature/**"]
  shared: ["src/index.js"]
  proof: "npm test -- test/feature"
  kind: feature
```
