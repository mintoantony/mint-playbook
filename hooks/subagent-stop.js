#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const lib = (n) => require(path.join(__dirname, '..', 'lib', n));
const hookio = lib('hookio.js');
const paths = lib('paths.js');
const state = lib('state.js');
const tasks = lib('tasks.js');
const { readJson } = lib('store.js');

function stateExists(root) {
  try {
    return !!state.load(root);
  } catch {
    return false; // unreadable state: every hook is a no-op
  }
}

const PLAYBOOK = path.join(__dirname, '..', 'bin', 'playbook.js');

function handler(input) {
  if (input.stop_hook_active) return null;
  const cwd = input.cwd || process.cwd();
  const loc = paths.locate(cwd);
  if (!loc || paths.rel(loc.wtRoot, loc.mainRoot) === '') return null;
  const { mainRoot, wtRoot } = loc;
  if (!stateExists(mainRoot)) return null; // plugin inactive in this repository
  const file = path.join(wtRoot, '.playbook', 'active-task.json');
  if (!fs.existsSync(file)) return null;
  const a = readJson(file, null);
  if (!a || typeof a !== 'object') return null;
  const c = tasks.checkProof(a);
  if (c.ok) return null;
  return {
    decision: 'block',
    reason: `Run \`node "${PLAYBOOK}" proof\` and paste the output before finishing. (${c.reason})`,
  };
}

module.exports = { handler };
if (require.main === module) hookio.run(handler);
