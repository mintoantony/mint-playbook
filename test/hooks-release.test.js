'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const state = require('../lib/state');
const guards = require('../lib/guards');

const root = path.join(__dirname, '..');
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

const st = (review, release) => {
  const f = state.newFeature('x', 'X');
  f.gates.review.status = review;
  f.gates.release.status = release;
  return { version: 1, activeFeature: 'x', features: { x: f } };
};
const dec = (toolName, toolInput, o = {}) => guards.decideRelease({
  toolName, toolInput, state: o.state || st('approved', 'approved'), slug: 'x', approvedChanges: o.ac || [],
});

test('decideRelease dev allows', () => {
  assert.strictEqual(dec('mcp__deploy-dev__release', { version: '1' }).decision, 'allow');
});
test('decideRelease staging asks', () => {
  const r = dec('mcp__deploy_staging__release', { version: '1.2' });
  assert.deepStrictEqual(r, { decision: 'ask', reason: 'Staging release of 1.2: confirm' });
});
test('decideRelease unknown env asks', () => {
  const r = dec('mcp__foo__release', { version: '1' });
  assert.deepStrictEqual(r, { decision: 'ask', reason: 'Release target not recognised (mcp__foo__release): confirm' });
});
test('decideRelease prod denies without ticket', () => {
  const r = dec('mcp__deploy-prod__release', { version: '1', ticket: 'T-1' });
  assert.strictEqual(r.decision, 'deny');
  assert.strictEqual(r.reason, 'Production needs an approved change ticket for 1 in release/approved-changes.json (release manager).');
});
test('decideRelease prod denies when gates not approved', () => {
  const r = dec('mcp__deploy-prod__release', { version: '1', ticket: 'T-1' }, { state: st('approved', 'pending'), ac: [{ ticket: 'T-1', version: '1' }] });
  assert.strictEqual(r.decision, 'deny');
  assert.match(r.reason, /review and release gates approved first \(current: review approved, release pending\)/);
});
test('decideRelease prod denies on version mismatch', () => {
  const r = dec('mcp__deploy-prod__release', { version: '2', ticket: 'T-1' }, { ac: [{ ticket: 'T-1', version: '1' }] });
  assert.strictEqual(r.decision, 'deny');
});
test('decideRelease prod allows with gates and ticket (trimmed)', () => {
  const r = dec('mcp__plugin_x_deploy_prod__release', { version: ' 1 ', ticket: 'T-1' }, { ac: [{ ticket: 'T-1', version: '1' }] });
  assert.strictEqual(r.decision, 'allow');
});

function repo() {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-rel-')));
  sh(d, 'init', '-q');
  sh(d, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-q', '--allow-empty', '-m', 'i');
  return d;
}
function withRepo(withState, fn) {
  const d = repo();
  try {
    if (withState) {
      fs.mkdirSync(path.join(d, '.playbook'), { recursive: true });
      fs.writeFileSync(path.join(d, '.playbook', 'state.json'), JSON.stringify(st('approved', 'approved')));
    }
    fn(d);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
}
function hook(cwd, tool_name, tool_input) {
  const r = spawnSync(process.execPath, [path.join(root, 'hooks', 'release-gate.js')], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, cwd, tool_input }), encoding: 'utf8',
  });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null;
}

test('hook: prod allowed with approved ticket', () => withRepo(true, (d) => {
  fs.mkdirSync(path.join(d, 'release'));
  fs.writeFileSync(path.join(d, 'release', 'approved-changes.json'), JSON.stringify([{ ticket: 'T-1', version: '1.0' }]));
  const o = hook(d, 'mcp__deploy-prod__release', { version: '1.0', ticket: 'T-1' });
  assert.strictEqual(o.permissionDecision, 'allow');
}));
test('hook: staging asks', () => withRepo(true, (d) => {
  const o = hook(d, 'mcp__deploy-staging__release', { version: '1.0' });
  assert.strictEqual(o.permissionDecision, 'ask');
  assert.match(o.permissionDecisionReason, /Staging release of 1.0/);
}));
test('hook: prod denied without approved-changes file', () => withRepo(true, (d) => {
  const o = hook(d, 'mcp__deploy-prod__release', { version: '1.0', ticket: 'T-1' });
  assert.strictEqual(o.permissionDecision, 'deny');
}));
test('hook: invalid approved-changes json denies prod', () => withRepo(true, (d) => {
  fs.mkdirSync(path.join(d, 'release'));
  fs.writeFileSync(path.join(d, 'release', 'approved-changes.json'), '{nope');
  assert.strictEqual(hook(d, 'mcp__deploy-prod__release', { version: '1', ticket: 'T' }).permissionDecision, 'deny');
}));
test('hook: no state is a no-op', () => withRepo(false, (d) => {
  assert.strictEqual(hook(d, 'mcp__deploy-prod__release', { version: '1.0', ticket: 'T-1' }), null);
}));
