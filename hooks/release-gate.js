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

// Returns the state, or null when missing (plugin inactive). Throws when unreadable twice.
function loadState(root) {
  let last;
  for (let i = 0; i < 2; i++) {
    try {
      return state.load(root);
    } catch (e) { last = e; }
  }
  throw last;
}

function approvedChanges(root) {
  try {
    const v = readJson(path.join(root, 'release', 'approved-changes.json'), []);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function handler(input) {
  const cwd = (input && input.cwd) || process.cwd();
  const loc = paths.locate(cwd);
  if (!loc) return null;
  const root = loc.mainRoot;
  const st = loadState(root);
  if (!st) return null;
  const r = guards.decideRelease({
    toolName: input.tool_name,
    toolInput: input.tool_input,
    state: st,
    slug: st.activeFeature,
    approvedChanges: approvedChanges(root),
  });
  return hookio[r.decision](EVENT, r.reason);
}

// A gate fails closed: deny on internal error.
handler.onError = (err) => hookio.deny(EVENT, `Release gate error: ${err && err.message}`);

module.exports = { handler };
if (require.main === module) hookio.run(handler);
