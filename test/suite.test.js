'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const suite = require('../lib/suite');
const { main } = require('../bin/playbook');

const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');

test('parseFailures: TAP', () => {
  const r = suite.parseFailures(fx('tap-simple.txt'), null);
  assert.deepStrictEqual(r, { failing: ['beta breaks', 'gamma without dash'], count: 2 });
});

test('parseFailures: node --test TAP output', () => {
  const r = suite.parseFailures(fx('tap-node.txt'), null);
  assert.deepStrictEqual(r, { failing: ['breaks here', 'later fails'], count: 2 });
});

test('parseFailures: TAP all passing gives empty list', () => {
  assert.deepStrictEqual(suite.parseFailures('TAP version 13\nok 1 - a\n1..1\n', null), { failing: [], count: 0 });
});

test('parseFailures: JUnit', () => {
  const r = suite.parseFailures('irrelevant', fx('junit-basic.txt'));
  assert.deepStrictEqual(r, { failing: ['a.B.fails <x> & "q"', 'errors no class'], count: 2 });
});

test('parseFailures: nothing recognisable', () => {
  assert.deepStrictEqual(suite.parseFailures('hello\n', null), { failing: null, count: null });
  assert.deepStrictEqual(suite.parseFailures('', null), { failing: null, count: null });
});

test('parseFailures: TAP summary count only', () => {
  const r = suite.parseFailures('# tests 5\n# pass 2\n# fail 3\n', null);
  assert.deepStrictEqual(r, { failing: null, count: 3 });
});

test('compare: ids', () => {
  const b = { failing: ['a', 'b'], count: 2, exit: 1 };
  assert.deepStrictEqual(suite.compare(b, { failing: ['a'], count: 1 }, 1), { ok: true, newFailures: [] });
  assert.deepStrictEqual(suite.compare(b, { failing: ['a', 'c', 'd'], count: 3 }, 1), { ok: false, newFailures: ['c', 'd'] });
});

test('compare: counts only', () => {
  const b = { failing: null, count: 2, exit: 1 };
  assert.strictEqual(suite.compare(b, { failing: null, count: 2 }, 1).ok, true);
  assert.strictEqual(suite.compare(b, { failing: null, count: 3 }, 1).ok, false);
});

test('compare: ids vs counts mismatch falls back to counts', () => {
  const b = { failing: null, count: 1, exit: 1 };
  assert.strictEqual(suite.compare(b, { failing: ['x', 'y'], count: 2 }, 1).ok, false);
  assert.strictEqual(suite.compare(b, { failing: ['x'], count: 1 }, 1).ok, true);
});

test('compare: exit-code fallback', () => {
  const none = { failing: null, count: null };
  assert.strictEqual(suite.compare({ ...none, exit: 0 }, none, 0).ok, true);
  assert.strictEqual(suite.compare({ ...none, exit: 0 }, none, 1).ok, false);
  assert.strictEqual(suite.compare({ ...none, exit: 1 }, none, 1).ok, true);
  assert.strictEqual(suite.compare({ ...none, exit: 1 }, none, 2).ok, false);
  assert.strictEqual(suite.compare({ ...none, exit: 1 }, none, 0).ok, true);
});

// ---- CLI ----
function repo() {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-suite-')));
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
function setup(fn) {
  const d = repo();
  try {
    assert.strictEqual(run(d, 'init', 'f1', '--title', 'F').code, 0);
    fn(d);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
}
const setCfg = (d, c) => {
  const f = path.join(d, '.playbook', 'config.json');
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), ...c }));
};
const stateOf = (d) => JSON.parse(fs.readFileSync(path.join(d, '.playbook', 'state.json'), 'utf8'));

test('cli: config.test missing', () => setup((d) => {
  setCfg(d, { test: null });
  const r = run(d, 'suite', 'baseline');
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /config\.test not set; set it in \.playbook\/config\.json/);
}));

test('cli: check without baseline', () => setup((d) => {
  setCfg(d, { test: 'node -e "process.exit(0)"' });
  const r = run(d, 'suite', 'check');
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /no baseline; run suite baseline first/);
}));

test('cli: baseline then check with TAP output, new failure detected', () => setup((d) => {
  fs.writeFileSync(path.join(d, 'out.txt'), 'ok 1 - a\nnot ok 2 - b\n');
  setCfg(d, { test: 'node -e "process.stdout.write(require(\'fs\').readFileSync(\'out.txt\',\'utf8\'));process.exit(1)"' });
  const b = run(d, 'suite', 'baseline');
  assert.strictEqual(b.code, 0);
  assert.deepStrictEqual(stateOf(d).features.f1.baseline, { failing: ['b'], count: 1, exit: 1 });
  assert.strictEqual(run(d, 'suite', 'check').code, 0);
  assert.match(run(d, 'suite', 'check').out, /suite: ok/);
  fs.writeFileSync(path.join(d, 'out.txt'), 'not ok 1 - a\nnot ok 2 - b\nnot ok 3 - c\n');
  const c = run(d, 'suite', 'check');
  assert.strictEqual(c.code, 1);
  assert.match(c.out, /suite: new failures: a, c/);
}));

test('cli: JUnit report via testReport, run from a subdirectory', () => setup((d) => {
  fs.writeFileSync(path.join(d, 'rep.xml'), '<testsuite><testcase classname="k" name="n"><failure/></testcase></testsuite>');
  setCfg(d, { test: 'node -e "process.exit(1)"', testReport: 'rep.xml' });
  fs.mkdirSync(path.join(d, 'sub'));
  run(d, 'suite', 'baseline');
  assert.deepStrictEqual(stateOf(d).features.f1.baseline, { failing: ['k.n'], count: 1, exit: 1 });
  assert.strictEqual(run(path.join(d, 'sub'), 'suite', 'check').code, 0);
}));
