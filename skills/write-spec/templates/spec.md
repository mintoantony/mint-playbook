# Spec: <feature title>

Author: <name>
Status: Draft
Intent: intent.md

## Current state

<Existing codebase: stack, structure, commands (setup, test, lint, format), conventions, tests, and the parts this feature touches, each with file paths. New project: "New project, no existing code." plus the chosen stack and why, with one alternative considered.>

## Requirements

<Numbered, testable, one behaviour each. Every requirement starts its line with its id in bold, so tasks can cite it.>

- **R1** — <the system must ...>
- **R2** — <the system must ...>

## Design

<How it works: components, data, interfaces, flows. Name files or modules where known. Enough for a planner to list the files that change.>

## Constraints and controls

| Constraint | Source | Control that enforces it |
|---|---|---|
| <e.g. no secrets in the repo> | <intent / policy skill / user> | <hook, test, CI check, review rule> |

## Areas of concern

| Concern | Why it matters | Owner |
|---|---|---|
| <risky area> | <what could go wrong> | <person or role who decides> |

<Policy clashes: when two policy skills disagree, list the clash here with both sides. Clashes are flagged, not resolved: the owner decides.>

## Open questions

- <carried forward from intent.md, plus new ones; "None" if nothing is open>
