'use strict';
const fs = require('node:fs');

const out = (event, fields) => ({ hookSpecificOutput: { hookEventName: event, ...fields } });
const deny = (event, reason) => out(event, { permissionDecision: 'deny', permissionDecisionReason: reason });
const ask = (event, reason) => out(event, { permissionDecision: 'ask', permissionDecisionReason: reason });
const allow = (event, reason) => out(event, { permissionDecision: 'allow', permissionDecisionReason: reason });
const context = (event, text) => out(event, { additionalContext: text });

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

// handler(input) -> result|null. handler.onError(err, rawStdin) -> result|null.
// Default onError logs to stderr and allows (prints nothing). Always exits 0.
function run(handler) {
  const raw = readStdin();
  let result = null;
  try {
    result = handler(JSON.parse(raw));
  } catch (err) {
    try {
      if (typeof handler.onError === 'function') result = handler.onError(err, raw);
      else process.stderr.write(`mint-playbook hook error: ${err && err.message}\n`);
    } catch (err2) {
      process.stderr.write(`mint-playbook hook error: ${err2 && err2.message}\n`);
    }
  }
  if (result != null) process.stdout.write(JSON.stringify(result));
  process.exitCode = 0;
}

module.exports = { run, deny, ask, allow, context };
