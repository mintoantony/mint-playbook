'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const state = require('../lib/state');
const hookio = require('../lib/hookio');
const guards = require('../lib/guards');

const root = path.join(__dirname, '..');
const DENY = 'Gates are approved only by the human typing /mint-playbook:approve';

function repo() {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-hook-')));
  execFileSync('git', ['init', '-q'], { cwd: d });
  return d;
}
function withRepo(fn) {
  const d = repo();
  try { fn(d); } finally { fs.rmSync(d, { recursive: true, force: true }); }
}
function writeState(d, mutate) {
  const f = state.newFeature('login', 'Login');
  const st = { version: 1, activeFeature: 'login', features: { login: f } };
  if (mutate) mutate(f);
  fs.mkdirSync(path.join(d, '.playbook'), { recursive: true });
  fs.writeFileSync(path.join(d, '.playbook', 'state.json'), JSON.stringify(st));
}
function hook(name, input) {
  const r = spawnSync(process.execPath, [path.join(root, 'hooks', name)], {
    input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const bash = (cwd, command) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd, tool_input: { command } });

test('hookio helpers shape output', () => {
  assert.deepStrictEqual(hookio.deny('PreToolUse', 'r'), { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'r' } });
  assert.strictEqual(hookio.ask('PreToolUse', 'r').hookSpecificOutput.permissionDecision, 'ask');
  assert.strictEqual(hookio.allow('PreToolUse', 'r').hookSpecificOutput.permissionDecision, 'allow');
  assert.deepStrictEqual(hookio.context('SessionStart', 't'), { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 't' } });
});

test('guards.decideApprovalCommand', () => {
  assert.strictEqual(guards.decideApprovalCommand('node "C:/x/bin/playbook.js" approve spec'), DENY);
  assert.strictEqual(guards.decideApprovalCommand('node bin/playbook.js ap""prove spec'), DENY);
  assert.strictEqual(guards.decideApprovalCommand("node bin/playbook.js 'reopen' spec"), DENY);
  assert.strictEqual(guards.decideApprovalCommand('node playbook reject spec'), DENY);
  assert.strictEqual(guards.decideApprovalCommand('node bin/playbook.js app\\rove spec'), DENY);
  assert.strictEqual(guards.decideApprovalCommand('npm test'), null);
  assert.strictEqual(guards.decideApprovalCommand('node bin/playbook.js request spec'), null);
  assert.strictEqual(guards.decideApprovalCommand(undefined), null);
});

test('H0 await-approval context', () => withRepo((d) => {
  writeState(d, (f) => { f.gates.intent.status = 'approved'; f.gates.spec.status = 'awaiting-approval'; });
  const r = hook('session-start.js', { hook_event_name: 'SessionStart', cwd: d });
  assert.strictEqual(r.code, 0, r.err);
  const o = JSON.parse(r.out).hookSpecificOutput;
  assert.strictEqual(o.hookEventName, 'SessionStart');
  assert.ok(o.additionalContext.includes('mint-playbook: feature login, gate spec awaiting your approval \u2014 /mint-playbook:approve spec'), o.additionalContext);
}));

test('H0 other actions, rework and stale', () => withRepo((d) => {
  writeState(d);
  let o = JSON.parse(hook('session-start.js', { cwd: d }).out).hookSpecificOutput.additionalContext;
  assert.match(o, /^mint-playbook: feature login, stage plan, next: write-intent \(intent\)/);
  assert.match(o, /run \/mint-playbook:playbook to continue/);
  writeState(d, (f) => { f.gates.intent.status = 'rejected'; f.gates.intent.reason = 'too vague'; });
  o = JSON.parse(hook('session-start.js', { cwd: d }).out).hookSpecificOutput.additionalContext;
  assert.match(o, /next: rework/);
  assert.match(o, /too vague/);
  writeState(d, (f) => { f.gates.intent.status = 'approved'; f.gates.spec.status = 'stale'; });
  o = JSON.parse(hook('session-start.js', { cwd: d }).out).hookSpecificOutput.additionalContext;
  assert.match(o, /gate spec is stale \(an earlier document was reopened\)/);
}));

test('H0 and H1 are no-ops without state, outside a repo, or with corrupt state', () => withRepo((d) => {
  assert.deepStrictEqual(hook('session-start.js', { cwd: d }), { code: 0, out: '', err: '' });
  assert.deepStrictEqual(hook('approval-guard.js', bash(d, 'node playbook.js approve spec')), { code: 0, out: '', err: '' });
  const nogit = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-nogit-')));
  try {
    assert.strictEqual(hook('session-start.js', { cwd: nogit }).out, '');
  } finally { fs.rmSync(nogit, { recursive: true, force: true }); }
  fs.mkdirSync(path.join(d, '.playbook'));
  fs.writeFileSync(path.join(d, '.playbook', 'state.json'), '{not json');
  let r = hook('session-start.js', { cwd: d });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.out, '');
  assert.match(r.err, /state unreadable/);
  r = hook('approval-guard.js', bash(d, 'node playbook.js approve spec'));
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.out, '');
}));

test('H1 denies approval commands when state exists', () => withRepo((d) => {
  writeState(d);
  for (const c of ['node "C:/x/bin/playbook.js" approve spec', 'node bin/playbook.js ap""prove spec', "node bin/playbook.js 'reject' spec x"]) {
    const r = hook('approval-guard.js', bash(d, c));
    assert.strictEqual(r.code, 0);
    const o = JSON.parse(r.out).hookSpecificOutput;
    assert.strictEqual(o.hookEventName, 'PreToolUse');
    assert.strictEqual(o.permissionDecision, 'deny');
    assert.strictEqual(o.permissionDecisionReason, DENY);
  }
  assert.strictEqual(hook('approval-guard.js', bash(d, 'npm test')).out, '');
  assert.strictEqual(hook('approval-guard.js', { cwd: d, tool_input: {} }).out, '');
}));

test('H1 onError denies only when the command matches', () => {
  const { handler } = require('../hooks/approval-guard.js');
  const raw = JSON.stringify(bash('/x', 'node playbook.js approve spec'));
  const res = handler.onError(new Error('boom'), raw);
  assert.strictEqual(res.hookSpecificOutput.permissionDecision, 'deny');
  assert.strictEqual(handler.onError(new Error('boom'), JSON.stringify(bash('/x', 'npm test'))), null);
  assert.strictEqual(handler.onError(new Error('boom'), 'garbage'), null);
  // unparseable raw text that still contains a matching command
  assert.strictEqual(handler.onError(new Error('boom'), 'node playbook.js approve spec').hookSpecificOutput.permissionDecision, 'deny');
});
