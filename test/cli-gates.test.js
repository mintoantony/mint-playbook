'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { main } = require('../bin/playbook');

function repo() {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-cli-')));
  const g = (...a) => execFileSync('git', a, { cwd: d, stdio: 'ignore' });
  g('init', '-q');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  fs.writeFileSync(path.join(d, 'README.md'), 'x\n');
  g('add', '.');
  g('commit', '-q', '-m', 'init');
  return d;
}
function run(cwd, ...argv) {
  let out = '';
  let err = '';
  const code = main(['node', 'playbook', ...argv], {
    cwd, stdout: { write: (s) => { out += s; } }, stderr: { write: (s) => { err += s; } },
  });
  return { code, out, err };
}
function withRepo(fn) {
  const d = repo();
  try { fn(d); } finally { fs.rmSync(d, { recursive: true, force: true }); }
}
const stateOf = (d) => JSON.parse(fs.readFileSync(path.join(d, '.playbook', 'state.json'), 'utf8'));
const doc = (d, slug, name, text = 'content\n') => {
  const dir = path.join(d, 'docs', 'playbook', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), text);
};

test('init creates state, config, gitignore', () => withRepo((d) => {
  const r = run(d, 'init', 'login', '--title', 'Login flow');
  assert.strictEqual(r.code, 0, r.err);
  const st = stateOf(d);
  assert.strictEqual(st.version, 1);
  assert.strictEqual(st.activeFeature, 'login');
  assert.strictEqual(st.features.login.title, 'Login flow');
  assert.strictEqual(st.features.login.branch, 'playbook/login');
  assert.strictEqual(st.features.login.gates.intent.status, 'pending');
  const cfg = JSON.parse(fs.readFileSync(path.join(d, '.playbook', 'config.json'), 'utf8'));
  assert.deepStrictEqual(cfg, { concurrency: 3, setup: null, test: null, lint: null, format: null, testReport: null, protected: [] });
  assert.match(fs.readFileSync(path.join(d, '.gitignore'), 'utf8'), /^\.playbook\/$/m);
  const again = run(d, 'init', 'x', '--title', 'X');
  assert.strictEqual(again.code, 1);
  assert.match(again.err, /playbook: already initialised; use feature new/);
}));

test('init outside a git repo errors', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-nogit-'));
  try {
    const r = run(d, 'init', 'x', '--title', 'X');
    assert.strictEqual(r.code, 1);
    assert.match(r.err, /playbook: not a git repository; run git init first/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('request/approve flow writes approval file', () => withRepo((d) => {
  run(d, 'init', 'login', '--title', 'L');
  let r = run(d, 'request', 'intent');
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /intent\.md not found at docs\/playbook\/login\/intent\.md/);
  doc(d, 'login', 'intent.md');
  assert.strictEqual(run(d, 'request', 'intent').code, 0);
  assert.strictEqual(stateOf(d).features.login.gates.intent.status, 'awaiting-approval');
  r = run(d, 'next', '--json');
  assert.deepStrictEqual(JSON.parse(r.out), {
    feature: 'login', stage: 'plan', gate: 'intent', action: 'await-approval', doc: 'docs/playbook/login/intent.md',
  });
  doc(d, 'login', 'intent.md', 'changed\n');
  r = run(d, 'approve', 'intent');
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /intent\.md changed since approval was requested; run request again/);
  assert.strictEqual(run(d, 'request', 'intent').code, 0);
  assert.strictEqual(run(d, 'approve', 'intent').code, 0);
  const st = stateOf(d);
  assert.strictEqual(st.features.login.gates.intent.status, 'approved');
  assert.strictEqual(st.features.login.approvals[0].by, 'human');
  const f = JSON.parse(fs.readFileSync(path.join(d, '.playbook', 'approvals', 'login-intent.json'), 'utf8'));
  assert.strictEqual(f.gate, 'intent');
  assert.match(f.hash, /^sha256:/);
  r = run(d, 'approve', 'intent');
  assert.match(r.err, /gate intent is not awaiting approval \(status: approved\)/);
  r = run(d, 'request', 'plan');
  assert.match(r.err, /gate spec must be approved first/);
}));

test('reject, rework, reopen', () => withRepo((d) => {
  run(d, 'init', 'login', '--title', 'L');
  doc(d, 'login', 'intent.md');
  run(d, 'request', 'intent');
  assert.strictEqual(run(d, 'reject', 'intent').code, 1);
  assert.strictEqual(run(d, 'reject', 'intent', 'too', 'vague').code, 0);
  assert.strictEqual(stateOf(d).features.login.gates.intent.reason, 'too vague');
  const n = JSON.parse(run(d, 'next', '--json').out);
  assert.strictEqual(n.action, 'rework');
  assert.strictEqual(n.reason, 'too vague');
  assert.match(run(d, 'reopen', 'intent').err, /cannot be reopened/);
  run(d, 'request', 'intent');
  run(d, 'approve', 'intent');
  doc(d, 'login', 'spec.md');
  run(d, 'request', 'spec');
  assert.strictEqual(run(d, 'reopen', 'intent').code, 0);
  const g = stateOf(d).features.login.gates;
  assert.strictEqual(g.intent.status, 'pending');
  assert.strictEqual(g.spec.status, 'stale');
}));

test('status human, json, --feature, feature new/use', () => withRepo((d) => {
  run(d, 'init', 'login', '--title', 'Login');
  let r = run(d, 'status');
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /login/);
  assert.match(r.out, /playbook\/login/);
  assert.match(r.out, /intent\s+pending/);
  assert.strictEqual(JSON.parse(run(d, 'status', '--json').out).title, 'Login');
  assert.strictEqual(run(d, 'feature', 'new', 'search', '--title', 'Search').code, 0);
  assert.strictEqual(stateOf(d).activeFeature, 'search');
  assert.strictEqual(run(d, 'feature', 'use', 'login').code, 0);
  assert.strictEqual(stateOf(d).activeFeature, 'login');
  assert.match(run(d, 'feature', 'use', 'nope').err, /unknown feature nope/);
  assert.strictEqual(JSON.parse(run(d, 'status', '--json', '--feature', 'search').out).title, 'Search');
  r = run(d, 'next');
  assert.match(r.out, /write-intent/);
}));

test('invalid state.json: friendly error, exit 1', () => withRepo((d) => {
  fs.mkdirSync(path.join(d, '.playbook'));
  fs.writeFileSync(path.join(d, '.playbook', 'state.json'), '{nope');
  const r = run(d, 'status');
  assert.strictEqual(r.code, 1);
  assert.ok(r.err.startsWith('playbook: state unreadable at '), r.err);
  assert.ok(r.err.includes('state.json'));
  assert.ok(!/\bat .*\.js:\d+/.test(r.err));
}));

test('missing state and unknown command', () => withRepo((d) => {
  assert.match(run(d, 'status').err, /playbook: not initialised/);
  const r = run(d, 'bogus');
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /playbook: unknown command bogus/);
  assert.match(r.err, /usage/i);
}));

test('spawned process exit code', () => withRepo((d) => {
  const bin = path.join(__dirname, '..', 'bin', 'playbook.js');
  const bad = spawnSync(process.execPath, [bin, 'bogus'], { cwd: d, encoding: 'utf8' });
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /unknown command bogus/);
  const ok = spawnSync(process.execPath, [bin, 'init', 'a', '--title', 'A'], { cwd: d, encoding: 'utf8' });
  assert.strictEqual(ok.status, 0, ok.stderr);
}));

// ---- final review fixes ----
const setState = (d, mutate) => {
  const file = path.join(d, '.playbook', 'state.json');
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  mutate(st);
  fs.writeFileSync(file, JSON.stringify(st));
};

test('rejected review: build while fix tasks remain, then rework; rejected release: rework', () => withRepo((d) => {
  run(d, 'init', 'login', '--title', 'L');
  setState(d, (st) => {
    const f = st.features.login;
    for (const g of ['intent', 'spec', 'plan', 'tasks']) f.gates[g].status = 'approved';
    f.gates.review.status = 'awaiting-approval';
    f.tasks = { T0: { status: 'done', attempts: 0 } };
  });
  assert.strictEqual(run(d, 'reject', 'review', 'login', 'leaks', 'the', 'token').code, 0);
  let n = JSON.parse(run(d, 'next', '--json').out);
  assert.strictEqual(n.action, 'rework');
  assert.strictEqual(n.gate, 'review');
  assert.strictEqual(n.reason, 'login leaks the token');
  const r = run(d, 'task', 'add', 'F1', '--title', 'Fix leak', '--owns', 'src/auth.js,test/auth.test.js', '--proof', 'true');
  assert.strictEqual(r.code, 0, r.err);
  n = JSON.parse(run(d, 'next', '--json').out);
  assert.strictEqual(n.action, 'build');
  assert.strictEqual(n.gate, 'review');
  assert.strictEqual(n.reason, 'login leaks the token');
  assert.strictEqual(run(d, 'task', 'set', 'F1', 'done').code, 0);
  n = JSON.parse(run(d, 'next', '--json').out);
  assert.strictEqual(n.action, 'rework');
  assert.strictEqual(n.gate, 'review');
  doc(d, 'login', 'review-report.md');
  assert.strictEqual(run(d, 'request', 'review').code, 0);
  assert.strictEqual(run(d, 'approve', 'review').code, 0);
  doc(d, 'login', 'release-notes.md');
  assert.strictEqual(run(d, 'request', 'release').code, 0);
  assert.strictEqual(run(d, 'reject', 'release', 'no', 'rollback').code, 0);
  n = JSON.parse(run(d, 'next', '--json').out);
  assert.strictEqual(n.action, 'rework');
  assert.strictEqual(n.gate, 'release');
  assert.strictEqual(n.reason, 'no rollback');
}));

test('feature use --none clears the active feature', () => withRepo((d) => {
  run(d, 'init', 'login', '--title', 'L');
  const r = run(d, 'feature', 'use', '--none');
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /no active feature/);
  assert.strictEqual(stateOf(d).activeFeature, null);
  const n = run(d, 'next', '--json');
  assert.strictEqual(n.code, 1);
  assert.match(n.err, /no active feature; run feature use <slug>/);
  assert.strictEqual(run(d, 'feature', 'use', 'login').code, 0);
  assert.strictEqual(stateOf(d).activeFeature, 'login');
}));
