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

// Characters that no shell (sh, cmd, PowerShell) expands inside double quotes.
const SAFE_PATH = /^[\w ./@+,=-]+$/;

// The configured command runs through the shell; the edited file reaches it as the
// worktree-relative path in place of {file} (or appended), only when that path holds
// no shell-special characters, and always as the PLAYBOOK_FILE environment variable.
function lint(template, target, relPath, wtRoot) {
  const env = { ...process.env, PLAYBOOK_FILE: target };
  let cmd = template;
  const wantsPath = template.includes('{file}') || !template.includes('PLAYBOOK_FILE');
  if (wantsPath) {
    if (!SAFE_PATH.test(relPath) || relPath.startsWith('-')) {
      process.stderr.write(`mint-playbook: lint skipped for ${relPath}: the name has shell-special characters (use $PLAYBOOK_FILE in the lint command)\n`);
      return;
    }
    const pre = /(["'])\{file\}\1/g; // placeholder already quoted by the user
    if (pre.test(template)) cmd = template.replace(pre, (m, q) => q + relPath + q);
    else if (template.includes('{file}')) cmd = template.split('{file}').join(`"${relPath}"`);
    else cmd = `${template} "${relPath}"`;
  }
  const r = spawnSync(cmd, { shell: true, cwd: wtRoot, env, encoding: 'utf8', timeout: LINT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
  if (r.error && r.error.code !== 'ETIMEDOUT') {
    process.stderr.write(`mint-playbook: could not run lint: ${r.error.message}\n`);
    return;
  }
  if (r.error || r.status !== 0) {
    const text = `${r.stdout || ''}${r.stderr || ''}`.trim().slice(0, 4000);
    const note = r.error ? `\n(lint timed out after ${LINT_TIMEOUT_MS / 1000}s)` : '';
    process.stderr.write(`lint failed for ${relPath}:\n${text}${note}\n`);
    exitCode = 2;
  }
}

function handler(input) {
  const cwd = input.cwd || process.cwd();
  const loc = paths.locate(cwd);
  if (!loc || !stateExists(loc.mainRoot)) return null;
  const { mainRoot, wtRoot } = loc;
  const ti = input.tool_input || {};
  const raw = ti.file_path || ti.notebook_path;
  if (typeof raw !== 'string' || !raw) return null;
  const target = path.resolve(cwd, raw);

  if (paths.rel(wtRoot, mainRoot) !== '') {
    try { recordEdit(wtRoot); } catch (e) { process.stderr.write(`mint-playbook: could not record edit: ${e.message}\n`); }
  }
  const cfg = readJson(path.join(mainRoot, '.playbook', 'config.json'), {}) || {};
  if (typeof cfg.lint !== 'string' || !cfg.lint.trim()) return null;
  const relPath = paths.rel(target, wtRoot);
  // Lint only files of this worktree, and never the playbook documents.
  if (!relPath || relPath === 'docs/playbook' || /^docs\/playbook\//i.test(relPath)) return null;
  lint(cfg.lint, target, relPath, wtRoot);
  return null;
}

module.exports = { handler };
if (require.main === module) {
  hookio.run(handler);
  if (exitCode) process.exitCode = exitCode;
}
