'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { render } = require('../statusline/statusline.js');
const state = require('../lib/state.js');

const SCRIPT = path.join(__dirname, '..', 'statusline', 'statusline.js');

function midBuild() {
  const f = state.newFeature('billing', 'Billing');
  for (const g of ['intent', 'spec', 'plan', 'tasks']) f.gates[g].status = 'approved';
  f.gates.review.status = 'awaiting-approval';
  for (let i = 1; i <= 9; i++) f.tasks[`T${i}`] = { status: i <= 4 ? 'done' : 'pending' };
  return { version: 1, activeFeature: 'billing', features: { billing: f } };
}

function run(dir, input) {
  return spawnSync(process.execPath, [SCRIPT], {
    input: input === undefined ? JSON.stringify({ workspace: { current_dir: dir }, cwd: dir }) : input,
    encoding: 'utf8',
  });
}

test('render shows slug, stage, gate, status and task counts', () => {
  const st = midBuild();
  assert.equal(render(st, 'billing'), '▶ billing · deploy · gate:review(awaiting-approval) · tasks 4/9');
});

test('render of a fresh feature shows first pending gate', () => {
  const st = { features: { a: state.newFeature('a') } };
  assert.equal(render(st, 'a'), '▶ a · plan · gate:intent(pending) · tasks 0/0');
});

test('render returns empty string for missing or odd state', () => {
  assert.equal(render(null, 'x'), '');
  assert.equal(render({ features: {} }, 'x'), '');
  assert.equal(render(midBuild(), undefined), '');
});

test('script prints the line for a project with state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-'));
  fs.mkdirSync(path.join(dir, '.playbook'));
  fs.writeFileSync(path.join(dir, '.playbook', 'state.json'), JSON.stringify(midBuild()));
  const r = run(dir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '▶ billing · deploy · gate:review(awaiting-approval) · tasks 4/9');
});

test('script prints nothing without state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-'));
  const r = run(dir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('script prints nothing for corrupt state or bad stdin', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-'));
  fs.mkdirSync(path.join(dir, '.playbook'));
  fs.writeFileSync(path.join(dir, '.playbook', 'state.json'), '{not json');
  let r = run(dir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  r = run(dir, 'garbage');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});
