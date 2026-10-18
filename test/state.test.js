'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const state = require('../lib/state');

function fresh() {
  return { version: 1, activeFeature: 'f', features: { f: state.newFeature('f', 'F') } };
}
function approveTo(st, upto) {
  for (const g of state.GATES.slice(0, state.GATES.indexOf(upto) + 1)) {
    state.request(st, 'f', g, 'h-' + g);
    state.approve(st, 'f', g, 'h-' + g);
  }
}

test('GATES and gateDoc', () => {
  assert.deepStrictEqual(state.GATES, ['intent', 'spec', 'plan', 'tasks', 'review', 'release']);
  assert.strictEqual(state.gateDoc('review'), 'review-report.md');
  assert.strictEqual(state.gateDoc('release'), 'release-notes.md');
  assert.strictEqual(state.gateDoc('spec'), 'spec.md');
});

test('request requires earlier gates approved', () => {
  const st = fresh();
  assert.throws(() => state.request(st, 'f', 'spec', 'x'), /gate intent must be approved first/);
});

test('approve fails when hash changed', () => {
  const st = fresh();
  approveTo(st, 'intent');
  state.request(st, 'f', 'spec', 'h1');
  assert.throws(() => state.approve(st, 'f', 'spec', 'h2'),
    /spec\.md changed since approval was requested; run request again/);
  assert.strictEqual(st.features.f.gates.spec.status, 'awaiting-approval');
});

test('approve requires awaiting-approval', () => {
  const st = fresh();
  assert.throws(() => state.approve(st, 'f', 'intent', 'h'),
    /gate intent is not awaiting approval \(status: pending\)/);
});

test('approve appends approvals entry', () => {
  const st = fresh();
  state.request(st, 'f', 'intent', 'h');
  const e = state.approve(st, 'f', 'intent', 'h');
  const a = st.features.f.approvals;
  assert.strictEqual(a.length, 1);
  assert.deepStrictEqual({ gate: a[0].gate, hash: a[0].hash, by: a[0].by }, { gate: 'intent', hash: 'h', by: 'human' });
  assert.ok(a[0].at);
  assert.strictEqual(e, a[0]);
});

test('reject needs reason and awaiting', () => {
  const st = fresh();
  state.request(st, 'f', 'intent', 'h');
  assert.throws(() => state.reject(st, 'f', 'intent', '  '), /reason/);
  state.reject(st, 'f', 'intent', 'too vague');
  assert.strictEqual(st.features.f.gates.intent.status, 'rejected');
  assert.strictEqual(st.features.f.gates.intent.reason, 'too vague');
  assert.throws(() => state.reject(st, 'f', 'intent', 'x'), /not awaiting approval/);
});

test('reopen marks downstream stale, leaves upstream', () => {
  const st = fresh();
  approveTo(st, 'plan');
  state.request(st, 'f', 'tasks', 'h-tasks');
  state.reopen(st, 'f', 'spec');
  const g = st.features.f.gates;
  assert.strictEqual(g.intent.status, 'approved');
  assert.strictEqual(g.spec.status, 'pending');
  assert.strictEqual(g.plan.status, 'stale');
  assert.strictEqual(g.tasks.status, 'stale');
  assert.strictEqual(g.review.status, 'pending');
  assert.throws(() => state.reopen(st, 'f', 'review'), /cannot be reopened/);
});

test('currentStep walks the sequence', () => {
  const st = fresh();
  const step = () => state.currentStep(st, 'f', '/x');
  let awaiting = 0;
  const upTo = (g) => {
    state.request(st, 'f', g, 'h');
    if (step().action === 'await-approval') awaiting++;
    state.approve(st, 'f', g, 'h');
  };
  assert.deepStrictEqual(step(), { stage: 'plan', gate: 'intent', action: 'write-intent' });
  upTo('intent');
  assert.deepStrictEqual(step(), { stage: 'design', gate: 'spec', action: 'write-spec' });
  upTo('spec');
  assert.strictEqual(step().action, 'write-plan');
  upTo('plan');
  assert.strictEqual(step().action, 'split-tasks');
  upTo('tasks');
  assert.strictEqual(step().action, 'build');
  st.features.f.tasks = { t1: { status: 'done' }, t2: { status: 'todo' } };
  assert.strictEqual(step().action, 'build');
  st.features.f.tasks.t2.status = 'done';
  assert.deepStrictEqual(step(), { stage: 'deploy', gate: 'review', action: 'write-review' });
  upTo('review');
  assert.strictEqual(step().action, 'write-release');
  upTo('release');
  assert.deepStrictEqual(step(), { stage: 'maintain', gate: null, action: 'done' });
  assert.strictEqual(awaiting, 6);
});

test('currentStep rework and stale', () => {
  const st = fresh();
  state.request(st, 'f', 'intent', 'h');
  state.reject(st, 'f', 'intent', 'nope');
  assert.deepStrictEqual(state.currentStep(st, 'f', '/x'),
    { stage: 'plan', gate: 'intent', action: 'rework', reason: 'nope' });
  const s2 = fresh();
  approveTo(s2, 'plan');
  state.reopen(s2, 'f', 'spec');
  assert.strictEqual(state.currentStep(s2, 'f', '/x').action, 'write-spec');
});

test('hashFile normalises CRLF', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-'));
  try {
    fs.writeFileSync(path.join(d, 'a'), 'x\r\ny\r\n');
    fs.writeFileSync(path.join(d, 'b'), 'x\ny\n');
    assert.strictEqual(state.hashFile(path.join(d, 'a')), state.hashFile(path.join(d, 'b')));
    assert.match(state.hashFile(path.join(d, 'a')), /^sha256:[0-9a-f]{64}$/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
