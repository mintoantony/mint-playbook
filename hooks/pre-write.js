#!/usr/bin/env node
'use strict';
const path = require('node:path');
const lib = (n) => require(path.join(__dirname, '..', 'lib', n));
const hookio = lib('hookio.js');
const guards = lib('guards.js');
const paths = lib('paths.js');
const state = lib('state.js');
const { readJson } = lib('store.js');

const EVENT = 'PreToolUse';

function loadState(root) {
  try {
    return state.load(root);
  } catch {
    try { return state.load(root); } catch { return null; } // one retry, then no-op
  }
}

function contentOf(ti) {
  if (typeof ti.new_string === 'string') return ti.new_string;
  if (typeof ti.content === 'string') return ti.content;
  if (typeof ti.new_source === 'string') return ti.new_source;
  if (Array.isArray(ti.edits)) return ti.edits.map((e) => (e && e.new_string) || '').join('\n');
  return '';
}

const sameDir = (a, b) => paths.rel(a, b) === '';

function handler(input) {
  const ti = (input && input.tool_input) || {};
  const tool = input && input.tool_name;
  const cwd = input.cwd || process.cwd();
  const mainRoot = paths.mainRoot(cwd);
  if (!mainRoot) return null;
  const st = loadState(mainRoot);
  if (!st) return null;
  const target = ti.file_path || ti.notebook_path;
  if (typeof target !== 'string' || !target) return null;
  const wtRoot = paths.worktreeRoot(cwd) || mainRoot;
  const abs = path.resolve(cwd, target);
  const relMain = paths.rel(abs, mainRoot);
  const relWt = paths.rel(abs, wtRoot);
  if (relMain === null && relWt === null) return null; // outside the repo

  const inMainSession = sameDir(wtRoot, mainRoot);
  const slug = st.activeFeature;
  const read = tool === 'Read';
  let activeTask = null;
  if (!read && !inMainSession) activeTask = readJson(path.join(wtRoot, '.playbook', 'active-task.json'), null);
  const config = read ? {} : readJson(path.join(mainRoot, '.playbook', 'config.json'), {}) || {};

  let reason;
  if (!read) reason = guards.decideWrite({ relMain, relWt, inMainSession, state: st, slug, activeTask, config });
  if (!reason) reason = guards.decideSecrets({ toolName: tool, relMain: relMain === null ? relWt : relMain, content: contentOf(ti) });
  if (!reason && !read) reason = guards.decideTestEdit({ relWt, activeTask });
  return reason ? hookio.deny(EVENT, reason) : null;
}

// Allow on internal error, except for anything under .playbook/.
handler.onError = (err, raw) => {
  let p = '';
  try {
    const ti = JSON.parse(raw).tool_input || {};
    p = String(ti.file_path || ti.notebook_path || '');
  } catch {
    p = String(raw || '');
  }
  const flat = p.split(String.fromCharCode(92)).join('/').replace(/\/\//g, '/');
  return /(^|[/"'\s])\.playbook(\/|$|["'])/i.test(flat) ? hookio.deny(EVENT, 'playbook state is protected (hook error)') : null;
};

module.exports = { handler };
if (require.main === module) hookio.run(handler);
