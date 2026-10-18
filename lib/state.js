'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readJson, writeJsonAtomic, withLock } = require('./store');
const { stateDir } = require('./paths');

const GATES = ['intent', 'spec', 'plan', 'tasks', 'review', 'release'];
const DOCS = {
  intent: 'intent.md', spec: 'spec.md', plan: 'plan.md', tasks: 'tasks.md',
  review: 'review-report.md', release: 'release-notes.md',
};
const STAGE = {
  intent: 'plan', spec: 'design', plan: 'build', tasks: 'build', build: 'build',
  review: 'deploy', release: 'deploy', done: 'maintain',
};
const WRITE = {
  intent: 'write-intent', spec: 'write-spec', plan: 'write-plan', tasks: 'split-tasks',
  release: 'write-release',
};

function gateDoc(gate) {
  if (!DOCS[gate]) throw new Error(`unknown gate ${gate} (expected one of ${GATES.join(', ')})`);
  return DOCS[gate];
}

function stateFile(mainRoot) {
  return path.join(stateDir(mainRoot), 'state.json');
}

function load(mainRoot) {
  return readJson(stateFile(mainRoot), null);
}

// fn must be synchronous; it mutates the state in place.
function update(mainRoot, fn) {
  const file = stateFile(mainRoot);
  return withLock(file, () => {
    const st = readJson(file, null);
    const out = fn(st);
    writeJsonAtomic(file, st);
    return out;
  });
}

function hashFile(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  return 'sha256:' + crypto.createHash('sha256').update(text).digest('hex');
}

function newFeature(slug, title) {
  const gates = {};
  for (const name of GATES) {
    gates[name] = { status: 'pending', hash: null, requestedAt: null, approvedAt: null, reason: null };
  }
  return {
    title: title || slug,
    branch: `playbook/${slug}`,
    createdAt: new Date().toISOString(),
    gates,
    tasks: {},
    extraTasks: [],
    baseline: null,
    approvals: [],
  };
}

function feature(st, slug) {
  const f = st && st.features && st.features[slug];
  if (!f) throw new Error(`unknown feature ${slug}`);
  return f;
}

function gateOf(st, slug, gate) {
  gateDoc(gate);
  return feature(st, slug).gates[gate];
}

function request(st, slug, gate, hash) {
  const f = feature(st, slug);
  const g = gateOf(st, slug, gate);
  for (const earlier of GATES.slice(0, GATES.indexOf(gate))) {
    if (f.gates[earlier].status !== 'approved') throw new Error(`gate ${earlier} must be approved first`);
  }
  if (g.status === 'approved') throw new Error(`gate ${gate} is already approved; use reopen first`);
  const h = typeof hash === 'function' ? hash() : hash; // lazy: ordering errors win over missing-doc errors
  g.status = 'awaiting-approval';
  g.hash = h;
  g.requestedAt = new Date().toISOString();
  g.approvedAt = null;
  g.reason = null;
}

function requireAwaiting(g, gate) {
  if (g.status !== 'awaiting-approval') {
    throw new Error(`gate ${gate} is not awaiting approval (status: ${g.status})`);
  }
}

function approve(st, slug, gate, hash) {
  const f = feature(st, slug);
  const g = gateOf(st, slug, gate);
  requireAwaiting(g, gate);
  if (g.hash !== hash) throw new Error(`${gateDoc(gate)} changed since approval was requested; run request again`);
  const entry = { gate, hash, at: new Date().toISOString(), by: 'human' };
  g.status = 'approved';
  g.approvedAt = entry.at;
  g.reason = null;
  f.approvals.push(entry);
  return entry;
}

function reject(st, slug, gate, reason) {
  const g = gateOf(st, slug, gate);
  requireAwaiting(g, gate);
  if (!reason || !String(reason).trim()) throw new Error('a reason is required to reject a gate');
  g.status = 'rejected';
  g.reason = String(reason).trim();
}

function reopen(st, slug, gate) {
  const f = feature(st, slug);
  const g = gateOf(st, slug, gate);
  if (g.status !== 'approved' && g.status !== 'stale') {
    throw new Error(`gate ${gate} cannot be reopened (status: ${g.status})`);
  }
  g.status = 'pending';
  g.approvedAt = null;
  for (const later of GATES.slice(GATES.indexOf(gate) + 1)) {
    const lg = f.gates[later];
    if (lg.status === 'approved' || lg.status === 'awaiting-approval') lg.status = 'stale';
  }
}

function currentStep(st, slug) {
  const f = feature(st, slug);
  const gate = GATES.find((n) => f.gates[n].status !== 'approved');
  if (!gate) return { stage: STAGE.done, gate: null, action: 'done' };
  const g = f.gates[gate];
  if (g.status === 'awaiting-approval') return { stage: STAGE[gate], gate, action: 'await-approval' };
  if (g.status === 'rejected') return { stage: STAGE[gate], gate, action: 'rework', reason: g.reason };
  if (gate === 'review') {
    const tasks = Object.values(f.tasks || {});
    if (tasks.length === 0 || tasks.some((t) => t.status !== 'done')) {
      return { stage: STAGE.build, gate, action: 'build' };
    }
    return { stage: STAGE.review, gate, action: 'write-review' };
  }
  return { stage: STAGE[gate], gate, action: WRITE[gate] };
}

module.exports = {
  GATES, gateDoc, stateFile, load, update, hashFile, newFeature,
  request, approve, reject, reopen, currentStep,
};
