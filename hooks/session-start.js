#!/usr/bin/env node
'use strict';
const path = require('node:path');
const lib = (n) => require(path.join(__dirname, '..', 'lib', n));
const hookio = lib('hookio.js');
const paths = lib('paths.js');
const state = lib('state.js');

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function loadState(root) {
  try {
    return state.load(root);
  } catch (e) {
    if (e.name !== 'StoreError') throw e;
    sleep(50); // Windows: state file briefly locked during atomic rename
    return state.load(root);
  }
}

function describe(st, slug) {
  const f = st.features[slug];
  const step = state.currentStep(st, slug, null);
  if (step.action === 'await-approval') {
    return [`mint-playbook: feature ${slug}, gate ${step.gate} awaiting your approval — /mint-playbook:approve ${step.gate}`];
  }
  if (step.action === 'done') {
    return [`mint-playbook: feature ${slug}, stage ${step.stage}, all gates approved`];
  }
  const lines = [];
  let head = `mint-playbook: feature ${slug}, stage ${step.stage}, next: ${step.action} (${step.gate})`;
  if (step.action === 'rework' && step.reason) head += ` — rejected: ${step.reason}`;
  lines.push(head);
  const g = f.gates[step.gate];
  if (g && g.status === 'stale') {
    lines.push(`mint-playbook: gate ${step.gate} is stale (an earlier document was reopened)`);
  }
  lines.push('mint-playbook: run /mint-playbook:playbook to continue');
  return lines;
}

function handler(input) {
  const root = paths.mainRoot((input && input.cwd) || process.cwd());
  if (!root) return null;
  let st;
  try {
    st = loadState(root);
  } catch (e) {
    if (e.name !== 'StoreError') throw e;
    process.stderr.write(`playbook: state unreadable at ${e.file || root}\n`);
    return null;
  }
  if (!st || !st.features) return null;
  const slug = st.activeFeature && st.features[st.activeFeature] ? st.activeFeature : Object.keys(st.features)[0];
  if (!slug) return null;
  return hookio.context('SessionStart', describe(st, slug).join('\n'));
}

module.exports = { handler };
if (require.main === module) hookio.run(handler);
