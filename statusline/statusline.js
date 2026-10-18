'use strict';
// Claude Code status line: one line of playbook progress, or nothing. Never throws.
const fs = require('node:fs');
const path = require('node:path');
const state = require('../lib/state');
const { mainRoot, stateDir } = require('../lib/paths');

function render(st, slug) {
  try {
    const f = st && st.features && slug && st.features[slug];
    if (!f) return '';
    const step = state.currentStep(st, slug);
    const gate = step.gate || state.GATES[state.GATES.length - 1];
    const status = f.gates[gate].status;
    const tasks = Object.values(f.tasks || {});
    const done = tasks.filter((t) => t && t.status === 'done').length;
    return `▶ ${slug} · ${step.stage} · gate:${gate}(${status}) · tasks ${done}/${tasks.length}`;
  } catch {
    return '';
  }
}

function findStateFile(cwd) {
  // Cheap walk-up first (no process spawn); git only for linked worktrees.
  let dir = path.resolve(cwd);
  for (;;) {
    const file = path.join(stateDir(dir), 'state.json');
    if (fs.existsSync(file)) return file;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const root = mainRoot(cwd);
  if (!root) return null;
  const file = path.join(stateDir(root), 'state.json');
  return fs.existsSync(file) ? file : null;
}

function main() {
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    const cwd = (input.workspace && input.workspace.current_dir) || input.cwd;
    if (!cwd) return '';
    const file = findStateFile(cwd);
    if (!file) return '';
    const st = JSON.parse(fs.readFileSync(file, 'utf8'));
    return render(st, st.activeFeature);
  } catch {
    return '';
  }
}

if (require.main === module) {
  const line = main();
  if (line) process.stdout.write(line + '\n');
}

module.exports = { render };
