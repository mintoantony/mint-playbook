#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const lib = (n) => require(path.join(__dirname, '..', 'lib', n));
const hookio = lib('hookio.js');
const paths = lib('paths.js');
const tasks = lib('tasks.js');
const { readJson } = lib('store.js');

const PLAYBOOK = path.join(__dirname, '..', 'bin', 'playbook.js');

function handler(input) {
  if (input.stop_hook_active) return null;
  const cwd = input.cwd || process.cwd();
  const mainRoot = paths.mainRoot(cwd);
  const wtRoot = paths.worktreeRoot(cwd);
  if (!mainRoot || !wtRoot || paths.rel(wtRoot, mainRoot) === '') return null;
  const file = path.join(wtRoot, '.playbook', 'active-task.json');
  if (!fs.existsSync(file)) return null;
  const a = readJson(file, null);
  if (!a || typeof a !== 'object') return null;
  const c = tasks.checkProof(a);
  if (c.ok) return null;
  return {
    decision: 'block',
    reason: `Run \`node "${PLAYBOOK}" proof\` and paste the output before finishing.  (${c.reason})`,
  };
}

module.exports = { handler };
if (require.main === module) hookio.run(handler);
