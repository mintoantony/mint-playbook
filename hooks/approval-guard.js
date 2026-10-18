#!/usr/bin/env node
'use strict';
const path = require('node:path');
const lib = (n) => require(path.join(__dirname, '..', 'lib', n));
const hookio = lib('hookio.js');
const guards = lib('guards.js');
const paths = lib('paths.js');
const state = lib('state.js');

const EVENT = 'PreToolUse';
function stateExists(cwd) {
  const root = paths.mainRoot(cwd);
  if (!root) return false;
  try {
    return !!state.load(root);
  } catch {
    return false; // unreadable state: every hook is a no-op
  }
}

function handler(input) {
  const command = input && input.tool_input && input.tool_input.command;
  const reason = guards.decideApprovalCommand(command);
  if (!reason) return null;
  if (!stateExists((input && input.cwd) || process.cwd())) return null;
  return hookio.deny(EVENT, reason);
}

handler.onError = (err, raw) => {
  let command = null;
  try { command = JSON.parse(raw).tool_input.command; } catch { /* use raw text */ }
  const text = typeof command === 'string' ? command : String(raw || '').split(String.fromCharCode(92)).join('');
  const reason = guards.decideApprovalCommand(text);
  return reason ? hookio.deny(EVENT, reason) : null;
};

module.exports = { handler };
if (require.main === module) hookio.run(handler);
