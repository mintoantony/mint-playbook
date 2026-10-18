#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const lib = (n) => require(path.join(__dirname, '..', 'lib', n));
const hookio = lib('hookio.js');
const paths = lib('paths.js');
const state = lib('state.js');
const { readJson, writeJsonAtomic, withLock } = lib('store.js');

const LINT_TIMEOUT_MS = 20000;
let exitCode = 0;

function stateExists(root) {
  for (let i = 0; i < 2; i++) {
    try {
      return !!state.load(root);
    } catch { /* retry once */ }
  }
  return false;
}

function recordEdit(wtRoot) {
  const file = path.join(wtRoot, '.playbook', 'active-task.json');
  if (!fs.existsSync(file)) return;
  withLock(file, () => {
    const a = readJson(file, null);
    if (!a || typeof a !== 'object') return;
    a.lastEditAt = new Date().toISOString();
    writeJsonAtomic(file, a);
  });
}

function lint(template, target, wtRoot) {
  const quoted = `"${target}"`;
  const cmd = template.includes('{file}') ? template.split('{file}').join(quoted) : `${template} ${quoted}`;
  const r = spawnSync(cmd, { shell: true, cwd: wtRoot, encoding: 'utf8', timeout: LINT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
  const relPath = paths.rel(target, wtRoot);
  const shown = relPath === null ? target : relPath;
  if (r.error && r.error.code !== 'ETIMEDOUT') {
    process.stderr.write(`mint-playbook: could not run lint: ${r.error.message}\n`);
    return;
  }
  if (r.error || r.status !== 0) {
    const text = `${r.stdout || ''}${r.stderr || ''}`.trim().slice(0, 4000);
    const note = r.error ? `\n(lint timed out after ${LINT_TIMEOUT_MS / 1000}s)` : '';
    process.stderr.write(`lint failed for ${shown}:\n${text}${note}\n`);
    exitCode = 2;
  }
}

function handler(input) {
  const cwd = input.cwd || process.cwd();
  const mainRoot = paths.mainRoot(cwd);
  if (!mainRoot || !stateExists(mainRoot)) return null;
  const wtRoot = paths.worktreeRoot(cwd) || mainRoot;
  const ti = input.tool_input || {};
  const raw = ti.file_path || ti.notebook_path;
  if (typeof raw !== 'string' || !raw) return null;
  const target = path.resolve(cwd, raw);

  if (paths.rel(wtRoot, mainRoot) !== '') {
    try { recordEdit(wtRoot); } catch (e) { process.stderr.write(`mint-playbook: could not record edit: ${e.message}\n`); }
  }
  const cfg = readJson(path.join(mainRoot, '.playbook', 'config.json'), {}) || {};
  if (typeof cfg.lint === 'string' && cfg.lint.trim()) lint(cfg.lint, target, wtRoot);
  return null;
}

module.exports = { handler };
if (require.main === module) {
  hookio.run(handler);
  if (exitCode) process.exitCode = exitCode;
}
