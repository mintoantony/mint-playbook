'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main } = require('../bin/playbook');

function withRepo(fn) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-cfg-')));
  const g = (...a) => execFileSync('git', a, { cwd: d, stdio: 'ignore' });
  g('init', '-q');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  fs.writeFileSync(path.join(d, 'README.md'), 'x\n');
  g('add', '.');
  g('commit', '-q', '-m', 'init');
  try { fn(d); } finally { fs.rmSync(d, { recursive: true, force: true }); }
}
function run(cwd, ...argv) {
  let out = '';
  let err = '';
  const code = main(['node', 'playbook', ...argv], {
    cwd, stdout: { write: (s) => { out += s; } }, stderr: { write: (s) => { err += s; } },
  });
  return { code, out, err };
}
const cfgOf = (d) => JSON.parse(fs.readFileSync(path.join(d, '.playbook', 'config.json'), 'utf8'));

test('config set writes string, integer, null and array keys', () => withRepo((d) => {
  assert.equal(run(d, 'init', 'demo', '--title', 'Demo').code, 0);
  assert.equal(run(d, 'config', 'set', 'test', 'npm test').code, 0);
  assert.equal(run(d, 'config', 'set', 'concurrency', '2').code, 0);
  assert.equal(run(d, 'config', 'set', 'protected', 'a/**, b.txt').code, 0);
  assert.equal(run(d, 'config', 'set', 'testReport', 'null').code, 0);
  const c = cfgOf(d);
  assert.equal(c.test, 'npm test');
  assert.strictEqual(c.concurrency, 2);
  assert.deepEqual(c.protected, ['a/**', 'b.txt']);
  assert.strictEqual(c.testReport, null);
}));

test('config set creates config.json when missing', () => withRepo((d) => {
  assert.equal(run(d, 'config', 'set', 'lint', 'npm run lint').code, 0);
  assert.equal(cfgOf(d).lint, 'npm run lint');
}));

test('config set rejects unknown keys and bad concurrency', () => withRepo((d) => {
  let r = run(d, 'config', 'set', 'bogus', 'x');
  assert.equal(r.code, 1);
  assert.match(r.err, /^playbook: unknown config key bogus \(allowed: .*concurrency.*\)/);
  for (const v of ['0', 'abc', '1.5']) {
    r = run(d, 'config', 'set', 'concurrency', v);
    assert.equal(r.code, 1);
    assert.match(r.err, /^playbook: concurrency must be an integer >= 1/);
  }
}));

test('config get prints one key or the whole file', () => withRepo((d) => {
  run(d, 'init', 'demo', '--title', 'Demo');
  run(d, 'config', 'set', 'format', 'npx prettier -w .');
  assert.equal(run(d, 'config', 'get', 'format').out.trim(), 'npx prettier -w .');
  assert.equal(JSON.parse(run(d, 'config', 'get').out).format, 'npx prettier -w .');
  assert.equal(run(d, 'config', 'get', 'nope').code, 1);
}));
