'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const tasks = require('../lib/tasks');
const { main } = require('../bin/playbook');

const T = (id, o = {}) => ({
  id, title: id, covers: [], depends_on: [], owns: ['test/' + id + '/**'], shared: [], proof: 'true', kind: 'task', ...o,
});
const msgs = (errs) => errs.map((e) => e.msg).join('\n');

test('parse reads the first yaml block with file line numbers', () => {
  const md = '# T\n\n```yaml\n- id: T0\n  title: Boot\n  covers: [R1, R2]\n  owns: [test/**]\n  proof: npm test\n  kind: bootstrap\n- id: T1\n  depends_on: [T0]\n```\n';
  const r = tasks.parse(md);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.tasks.length, 2);
  assert.deepStrictEqual(r.tasks[0].covers, ['R1', 'R2']);
  assert.strictEqual(r.tasks[0].kind, 'bootstrap');
  assert.deepStrictEqual(r.tasks[1].depends_on, ['T0']);
  assert.strictEqual(r.tasks[1].line, 10);
});

test('parse: no yaml block', () => {
  assert.deepStrictEqual(tasks.parse('# nothing\n').errors, [{ line: 1, msg: 'no yaml task block found' }]);
});

test('parse: entry missing id is line numbered', () => {
  const r = tasks.parse('x\n```yaml\n- id: T0\n  proof: p\n- title: no id\n  proof: p\n```\n');
  assert.deepStrictEqual(r.errors, [{ line: 5, msg: 'task entry is missing "id"' }]);
});

test('parse: yaml syntax error gets file line', () => {
  const r = tasks.parse('a\nb\n```yaml\n- id: T0\n  bad line\n```\n');
  assert.strictEqual(r.errors.length, 1);
  assert.strictEqual(r.errors[0].line, 5);
});

test('requirementIds', () => {
  const ids = tasks.requirementIds('# Spec\n- R1 a\n* **R2** b\n## R3 c\ntext R9\n  R4 x\n');
  assert.deepStrictEqual(ids, ['R1', 'R2', 'R3', 'R4']);
});

test('validate: ok baseline and uncovered requirement', () => {
  const ts = [T('T0', { kind: 'bootstrap', covers: ['R1'] })];
  assert.deepStrictEqual(tasks.validate(ts, ['R1']), []);
  assert.match(msgs(tasks.validate(ts, ['R1', 'R2'])), /R2/);
});

test('validate: duplicate ids, missing deps, missing proof, no test glob, no T0', () => {
  const dup = tasks.validate([T('T0'), T('T0')], []);
  assert.match(msgs(dup), /duplicate task id T0/);
  assert.match(msgs(tasks.validate([T('T0'), T('T1', { depends_on: ['T9'] })], [])), /T1.*T9/);
  assert.match(msgs(tasks.validate([T('T0', { proof: null })], [])), /T0.*proof/);
  assert.match(msgs(tasks.validate([T('T0', { owns: ['src/**'] })], [])), /T0.*test/);
  assert.deepStrictEqual(tasks.validate([T('T0', { owns: ['src/**'], kind: 'bootstrap' })], []), []);
  assert.match(msgs(tasks.validate([T('T1')], [])), /T0/);
});

test('validate: cycle message names the cycle', () => {
  const ts = [T('T0'), T('T2', { depends_on: ['T3'] }), T('T3', { depends_on: ['T2'] })];
  assert.match(msgs(tasks.validate(ts, [])), /T2 -> T3 -> T2/);
});

test('validate: overlapping owns', () => {
  const a = T('T1', { owns: ['src/**', 'test/a/**'] });
  const b = T('T2', { owns: ['src/api/**', 'test/b/**'] });
  const m = msgs(tasks.validate([T('T0'), a, b], []));
  assert.match(m, /T1/);
  assert.match(m, /T2/);
  assert.match(m, /overlap/);
  // dependent tasks may overlap, even transitively
  const c = { ...b, depends_on: ['T9'] };
  const mid = T('T9', { depends_on: ['T1'] });
  assert.deepStrictEqual(tasks.validate([T('T0'), a, mid, c], []), []);
});

test('waves and nextWave', () => {
  const ts = [T('T0'), T('T1', { depends_on: ['T0'] }), T('T2', { depends_on: ['T0'] }), T('T3', { depends_on: ['T1', 'T2'] })];
  assert.deepStrictEqual(tasks.waves(ts, {}), [['T0'], ['T1', 'T2'], ['T3']]);
  assert.deepStrictEqual(tasks.nextWave(ts, {}, 3), ['T0']);
  const st = { T0: { status: 'done' } };
  assert.deepStrictEqual(tasks.nextWave(ts, st, 3), ['T1', 'T2']);
  assert.deepStrictEqual(tasks.nextWave(ts, st, 1), ['T1']);
  st.T1 = { status: 'failed', attempts: 2 };
  st.T2 = { status: 'failed', attempts: 1 };
  assert.deepStrictEqual(tasks.nextWave(ts, st, 3), ['T2']);
  assert.deepStrictEqual(tasks.nextWave(ts, { T0: 'done', T1: 'in-progress' }, 3), ['T2']);
});

// ---- CLI ----
function repo() {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-tasks-')));
  const g = (...a) => execFileSync('git', a, { cwd: d, stdio: 'ignore' });
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  fs.writeFileSync(path.join(d, 'README.md'), 'x\n');
  g('add', '.'); g('commit', '-q', '-m', 'init');
  return d;
}
function run(cwd, ...argv) {
  let out = ''; let err = '';
  const code = main(['node', 'playbook', ...argv], {
    cwd, stdout: { write: (s) => { out += s; } }, stderr: { write: (s) => { err += s; } },
  });
  return { code, out, err };
}
const stateOf = (d) => JSON.parse(fs.readFileSync(path.join(d, '.playbook', 'state.json'), 'utf8'));
function setup(tasksMd, spec = '- R1 thing\n') {
  const d = repo();
  assert.strictEqual(run(d, 'init', 'f').code, 0);
  const dir = path.join(d, 'docs', 'playbook', 'f');
  fs.mkdirSync(dir, { recursive: true });
  if (tasksMd !== null) fs.writeFileSync(path.join(dir, 'tasks.md'), tasksMd);
  fs.writeFileSync(path.join(dir, 'spec.md'), spec);
  return d;
}
const GOOD = '# Tasks\n\n```yaml\n- id: T0\n  title: Boot\n  covers: [R1]\n  owns: [test/**]\n  proof: node -e "process.exit(0)"\n  kind: bootstrap\n- id: T1\n  title: One\n  depends_on: [T0]\n  owns: [src/one.js, test/one.test.js]\n  proof: node -e "process.exit(3)"\n```\n';
const clean = (d) => fs.rmSync(d, { recursive: true, force: true });
const rmWt = (d, wt) => {
  try { execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: d, stdio: 'ignore' }); } catch { /* ignore */ }
  clean(d);
};

test('tasks validate: ok seeds state', () => {
  const d = setup(GOOD);
  try {
    const r = run(d, 'tasks', 'validate');
    assert.strictEqual(r.code, 0, r.err);
    assert.strictEqual(r.out, 'tasks: ok (2 tasks, 2 waves)\n');
    assert.deepStrictEqual(stateOf(d).features.f.tasks, { T0: { status: 'todo', attempts: 0 }, T1: { status: 'todo', attempts: 0 } });
  } finally { clean(d); }
});

test('tasks validate: no yaml block -> tasks.md:1 and exit 1', () => {
  const d = setup('# nothing here\n');
  try {
    const r = run(d, 'tasks', 'validate');
    assert.strictEqual(r.code, 1);
    assert.match(r.err, /tasks\.md:1: no yaml task block found/);
    assert.ok(!/at .*\.js:\d+/.test(r.err));
  } finally { clean(d); }
});

test('tasks validate: malformed entry is line numbered', () => {
  const d = setup('a\n```yaml\n- id: T0\n  owns: [test/**]\n  proof: p\n  kind: bootstrap\n- title: x\n```\n');
  try {
    const r = run(d, 'tasks', 'validate');
    assert.strictEqual(r.code, 1);
    assert.match(r.err, /tasks\.md:7: task entry is missing "id"/);
  } finally { clean(d); }
});

test('tasks validate: validation error without line', () => {
  const d = setup(GOOD, '- R1 a\n- R2 b\n');
  try {
    const r = run(d, 'tasks', 'validate');
    assert.strictEqual(r.code, 1);
    assert.match(r.err, /^tasks\.md: .*R2/m);
  } finally { clean(d); }
});

test('waves, waves --json, --next --limit', () => {
  const d = setup(GOOD);
  try {
    assert.strictEqual(run(d, 'waves').out, 'wave 1: T0\nwave 2: T1\n');
    assert.strictEqual(run(d, 'waves', '--json').out.trim(), '[["T0"],["T1"]]');
    assert.strictEqual(run(d, 'waves', '--next', '--json').out.trim(), '["T0"]');
    run(d, 'task', 'set', 'T0', 'done');
    assert.strictEqual(run(d, 'waves', '--next', '--limit', '1', '--json').out.trim(), '["T1"]');
  } finally { clean(d); }
});

test('task set / add / progress', () => {
  const d = setup(GOOD);
  try {
    let r = run(d, 'task', 'set', 'T1', 'dispatched', '--branch', 'b1', '--worktree', 'w1', '--sha', 'abc');
    assert.strictEqual(r.code, 0, r.err);
    const t = stateOf(d).features.f.tasks.T1;
    assert.strictEqual(t.status, 'dispatched');
    assert.strictEqual(t.branch, 'b1');
    assert.strictEqual(t.worktree, 'w1');
    assert.strictEqual(t.sha, 'abc');
    assert.ok(t.dispatchedAt);
    run(d, 'task', 'set', 'T1', 'failed');
    run(d, 'task', 'set', 'T1', 'failed');
    assert.strictEqual(stateOf(d).features.f.tasks.T1.attempts, 2);
    assert.strictEqual(run(d, 'task', 'set', 'T1', 'bogus').code, 1);
    assert.strictEqual(run(d, 'task', 'set', 'T9', 'done').code, 1);
    r = run(d, 'task', 'add', 'X1', '--title', 'Extra', '--owns', 'src/x.js,test/x.test.js', '--proof', 'true', '--depends', 'T0');
    assert.strictEqual(r.code, 0, r.err);
    const ex = stateOf(d).features.f.extraTasks;
    assert.strictEqual(ex[0].id, 'X1');
    assert.deepStrictEqual(ex[0].owns, ['src/x.js', 'test/x.test.js']);
    assert.deepStrictEqual(ex[0].depends_on, ['T0']);
    assert.strictEqual(run(d, 'task', 'add', 'X1', '--proof', 'true', '--owns', 'a').code, 1);
    assert.strictEqual(run(d, 'waves', '--json').out.trim(), '[["T0"],["T1","X1"]]');
    r = run(d, 'progress');
    assert.strictEqual(r.code, 0, r.err);
    const md = fs.readFileSync(path.join(d, 'docs', 'playbook', 'f', 'progress.md'), 'utf8');
    assert.match(md, /\| T1 \| One \| failed \|/);
    assert.match(md, /\| X1 \| Extra \| todo \|/);
  } finally { clean(d); }
});

test('task start/lock-tests/proof/check in a worktree', () => {
  const d = setup(GOOD);
  const wt = d + '-wt';
  try {
    assert.strictEqual(run(d, 'tasks', 'validate').code, 0);
    assert.match(run(d, 'task', 'start', 'T0').err, /must run inside a builder worktree/);
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'playbook/f-t0', wt], { cwd: d, stdio: 'ignore' });
    assert.strictEqual(run(wt, 'proof').code, 1); // no active task
    const r = run(wt, 'task', 'start', 'T0');
    assert.strictEqual(r.code, 0, r.err);
    const at = path.join(wt, '.playbook', 'active-task.json');
    const a = JSON.parse(fs.readFileSync(at, 'utf8'));
    assert.strictEqual(a.id, 'T0');
    assert.deepStrictEqual(a.lockedTests, []);
    assert.strictEqual(a.lastEditAt, null);
    assert.deepStrictEqual(a.proofs, []);
    assert.ok(a.startedAt);
    const t = stateOf(d).features.f.tasks.T0;
    assert.strictEqual(t.status, 'in-progress');
    assert.strictEqual(t.branch, 'playbook/f-t0');
    assert.strictEqual(path.resolve(t.worktree), path.resolve(wt));

    assert.strictEqual(run(wt, 'task', 'lock-tests', 'test/a.test.js', path.join(wt, 'test', 'b.test.js')).code, 0);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(at, 'utf8')).lockedTests, ['test/a.test.js', 'test/b.test.js']);

    assert.match(run(d, 'task', 'check', 'T0').err, /no proof run/);
    const p = run(wt, 'proof');
    assert.strictEqual(p.code, 0, p.err);
    assert.strictEqual(JSON.parse(fs.readFileSync(at, 'utf8')).proofs.length, 1);
    assert.strictEqual(stateOf(d).features.f.tasks.T0.proofs[0].exit, 0);
    let c = run(d, 'task', 'check', 'T0');
    assert.strictEqual(c.code, 0, c.err);
    assert.match(c.out, /task T0: proof passed/);

    // edited after the proof
    const j = JSON.parse(fs.readFileSync(at, 'utf8'));
    j.lastEditAt = new Date(Date.now() + 60000).toISOString();
    fs.writeFileSync(at, JSON.stringify(j));
    c = run(d, 'task', 'check', 'T0');
    assert.strictEqual(c.code, 1);
    assert.match(c.err, /edited after last proof/);

    // failing proof
    j.lastEditAt = null;
    j.proof = 'node -e "process.exit(3)"';
    fs.writeFileSync(at, JSON.stringify(j));
    assert.strictEqual(run(wt, 'proof').code, 3);
    c = run(d, 'task', 'check', 'T0');
    assert.strictEqual(c.code, 1);
    assert.match(c.err, /last proof failed \(exit 3\)/);
  } finally { rmWt(d, wt); }
});

test('proof output is forwarded to the provided streams', () => {
  const d = setup(GOOD);
  const wt = d + '-wt2';
  try {
    run(d, 'tasks', 'validate');
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'b2', wt], { cwd: d, stdio: 'ignore' });
    run(wt, 'task', 'start', 'T0');
    const at = path.join(wt, '.playbook', 'active-task.json');
    const j = JSON.parse(fs.readFileSync(at, 'utf8'));
    j.proof = 'node -e "console.log(1234);console.error(5678)"';
    fs.writeFileSync(at, JSON.stringify(j));
    const r = run(wt, 'proof');
    assert.match(r.out, /1234/);
    assert.match(r.err, /5678/);
  } finally { rmWt(d, wt); }
});
