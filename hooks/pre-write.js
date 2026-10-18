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

// Returns the state, null when missing (plugin inactive) or 'corrupt' when unreadable.
function loadState(root) {
  for (let i = 0; i < 2; i++) {
    try {
      return state.load(root);
    } catch { /* retry once */ }
  }
  return 'corrupt';
}

const safeJson = (file, fallback) => {
  try { return readJson(file, fallback); } catch { return fallback; }
};

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
  const loc = paths.locate(cwd);
  if (!loc) return null;
  const { mainRoot, wtRoot } = loc;
  const st = loadState(mainRoot);
  if (!st) return null;
  const target = ti.file_path || ti.notebook_path;
  if (typeof target !== 'string' || !target) return null;
  const abs = path.resolve(cwd, target);
  const relMain = paths.rel(abs, mainRoot);
  const relWt = paths.rel(abs, wtRoot);
  if (relMain === null && relWt === null) return null; // outside the repo

  const read = tool === 'Read';
  if (st === 'corrupt') {
    // State unreadable: only .playbook/** stays protected (spec 7.6).
    return !read && guards.underPlaybook(relMain, relWt)
      ? hookio.deny(EVENT, 'playbook state is unreadable; fix .playbook/state.json before changing .playbook/')
      : null;
  }

  // Builder: a subagent (payload carries agent_id) working in a linked worktree. A user's own
  // session in a linked worktree, or a subagent in the main checkout, is the main session.
  const inMainSession = !input.agent_id || sameDir(wtRoot, mainRoot);
  const slug = st.activeFeature;
  let activeTask = !read && !inMainSession
    ? safeJson(path.join(wtRoot, '.playbook', 'active-task.json'), null) : null;
  if (activeTask && typeof activeTask !== 'object') activeTask = null;
  const config = read ? {} : safeJson(path.join(mainRoot, '.playbook', 'config.json'), {}) || {};

  // Order: always-deny, H4 secrets, H3 test lock, H2 gate/ownership.
  let reason = null;
  if (!read) reason = guards.decideAlwaysDeny({ relMain, relWt, state: st, slug, config });
  if (!reason) reason = guards.decideSecrets({ toolName: tool, relMain: relMain === null ? relWt : relMain, content: contentOf(ti) });
  if (!reason && !read) reason = guards.decideTestEdit({ relWt, activeTask });
  if (!reason && !read) reason = guards.decideWrite({ relMain, relWt, inMainSession, state: st, slug, activeTask, config });
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
