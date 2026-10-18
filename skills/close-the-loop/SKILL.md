---
name: close-the-loop
description: Maintains a shipped feature by watching production metrics against control bands and turning a finding or incident into a new playbook feature that stops at the intent gate. Use when a band alert fires, the user reports a production incident, wants to set up bands.yaml monitoring, or runs /maintain.
---

# Close the loop

Maintain is the last stage and the first: a production signal becomes a new feature that enters the playbook at the `intent` gate. Nothing is built or changed until the user approves that intent.

CLI: `node "<skill base directory>/../../bin/playbook.js" ...`

## Set up monitoring (opt-in)

First run `node "<skill base directory>/../../bin/playbook.js" next --json`. Where the files go depends on it:

- **A feature is in flight** (`action` is not `done`) and its `tasks` gate is not approved yet: write the files as bootstrap proposals under `docs/playbook/<slug>/bootstrap/` at the same relative paths (`bootstrap/bands.yaml`, `bootstrap/detect-bands.js`, `bootstrap/.github/workflows/bands.yml`). Source writes are gated while a feature is in flight; the tasks approval covers the proposals and T0 applies them. When `tasks.md` already exists, its `T0` must also own the three root paths: tell the user, and revise `tasks.md` through the `mint-playbook:split-tasks` skill before the tasks gate is approved.
- **A feature is in flight past the `tasks` gate:** the bootstrap is already applied. Tell the user monitoring is set up once the feature is done (or after `playbook.js feature use --none`), and stop here.
- **The feature is `done`, `next` reports `no active feature`, or there is no playbook state:** copy the files to the project directly.

The files, from this skill's `templates/`:

- `bands.yaml` to the project root. Rename the metrics to match the monitoring export.
- `detect-bands.js` to the project root. It has no dependencies.
- `workflows/bands.yml` to `.github/workflows/bands.yml`. Replace the marked placeholder step so it writes `metrics.json`: `{ "<metric>": [ { "t": "<ISO time>", "v": <number> } ] }`, hourly points covering the last 30 days plus the recent window.

The detector compares the newest points with the 30 days before them, using Western Electric rules:

| Tier | Rule | Action |
|---|---|---|
| `1sigma` | 4 of 5 beyond 1 sigma on one side, or 8 in a row on one side of the mean | log it |
| `2sigma` | 2 of 3 beyond 2 sigma on one side | diagnose read-only |
| `3sigma` | 1 point beyond 3 sigma | propose a fix |

A flat baseline (sd of zero) never fires. Run it by hand with `node detect-bands.js bands.yaml metrics.json`; it prints JSON findings with each tier's `action`.

## Per finding

1. **Log.** Record the finding (metric, tier, rule, latest value, time) in the project's incident log or ticket. A `1sigma` finding stops here unless it repeats.
2. **Diagnose, read-only.** For `2sigma` and `3sigma`, save the finding and any logs to a file, then dispatch the `incident-analyst` agent with those paths. It reads and reports; it changes nothing.
3. **Triage.** Show the user the diagnosis and its recommendation: **fix now**, **schedule**, or **dismiss**. The user decides. On dismiss, note why in the log and stop.
4. **Propose.** For fix now or schedule:
   1. Run `node "<skill base directory>/../../bin/playbook.js" status` and note the feature that is active now. If one is active and not finished, tell the user the Maintain feature will become the active one, and that they can return with `playbook.js feature use <previous>` (offer this again at the end).
   2. Pick a short slug, for example `fix-checkout-errors`. When step 1 printed `not initialised` (no playbook state yet), run `node "<skill base directory>/../../bin/playbook.js" init <slug> --title "<short title>"`, and commit `.gitignore` if `git status --short` shows it changed (`git add .gitignore && git commit -m "chore: ignore playbook state"`). Otherwise run `node "<skill base directory>/../../bin/playbook.js" feature new <slug> --title "<short title>"`. Either creates the feature and makes it active.
   3. Draft `docs/playbook/<slug>/intent.md` from `../capture-intent/templates/intent.md`. Put the signal in **Problem** with its numbers and the diagnosis evidence. Put the metric returning inside its band in **Proposed outcome**. Set `Status: Draft`.
   4. Commit it: `git add docs/playbook/<slug>/intent.md && git commit -m "docs(<slug>): intent draft"`.
   5. Run `node "<skill base directory>/../../bin/playbook.js" request intent`.
   6. **Stop.** Tell the user:

```
Intent drafted for <slug> from the <tier> finding on <metric>.
To approve, type:  /mint-playbook:approve intent
To send it back:   /mint-playbook:reject intent "<reason>"
```

The human approves. You never run approve, reject or reopen, and you do not start the spec until the intent gate is approved. Then continue with the playbook skill.

## Every shipped fix adds an eval

When the fix ships, add an eval so the regression is caught next time. Write one JSON file in `evals/` (see the evals skill) with `source` pointing at the incident or finding (ticket, log entry or PR link), `from` set to the fixed commit's parent, a `prompt` that reproduces the task, `may_change` limited to the files the fix touches, and `checks` that fail on the old behaviour.
