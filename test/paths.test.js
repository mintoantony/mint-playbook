'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const paths = require('../lib/paths');

const win = process.platform === 'win32';

test('rel', () => {
  if (win) assert.strictEqual(paths.rel('D:\\p\\src\\a.js', 'd:/p'), 'src/a.js');
  else assert.strictEqual(paths.rel('/p/src/a.js', '/p'), 'src/a.js');
  assert.strictEqual(paths.rel('/tmp/x', '/p'), null);
  assert.strictEqual(paths.rel('/p2/x', '/p'), null);
});

test('stateDir and featureDir', () => {
  assert.strictEqual(paths.stateDir('/r'), path.join('/r', '.playbook'));
  assert.strictEqual(paths.featureDir('/r', 'f1'), path.join('/r', 'docs', 'playbook', 'f1'));
});

test('mainRoot / worktreeRoot, incl. linked worktree; null outside git', () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-')));
  try {
    const repo = path.join(tmp, 'repo');
    const wt = path.join(tmp, 'wt');
    fs.mkdirSync(repo);
    const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' });
    git('init', '-q');
    git('-c', 'user.email=a@b', '-c', 'user.name=t', 'commit', '--allow-empty', '-q', '-m', 'i');
    git('worktree', 'add', '-q', wt, '-b', 'side');
    const norm = (p) => path.resolve(p).toLowerCase();
    assert.strictEqual(norm(paths.mainRoot(repo)), norm(repo));
    assert.strictEqual(norm(paths.mainRoot(wt)), norm(repo));
    assert.strictEqual(norm(paths.worktreeRoot(wt)), norm(wt));
    const plain = path.join(tmp, 'plain');
    fs.mkdirSync(plain);
    assert.strictEqual(paths.mainRoot(plain), null);
    assert.strictEqual(paths.worktreeRoot(plain), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
