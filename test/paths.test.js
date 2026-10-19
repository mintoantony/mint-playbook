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
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-')));
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

// ---- final review fixes: hook fast path ----
test('locate: walk-up for plain repos and nested worktrees, git only for other linked worktrees', () => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-loc-')));
  const g = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'ignore' });
  try {
    const main = path.join(base, 'main');
    fs.mkdirSync(path.join(main, 'src', 'deep'), { recursive: true });
    g(main, 'init', '-q');
    g(main, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-q', '--allow-empty', '-m', 'i');
    const nested = path.join(main, '.claude', 'worktrees', 'agent-x');
    fs.mkdirSync(path.dirname(nested), { recursive: true });
    g(main, 'worktree', 'add', '-q', '-b', 'n1', nested);
    const outside = path.join(base, 'wt');
    g(main, 'worktree', 'add', '-q', '-b', 'o1', outside);
    const plain = path.join(base, 'plain');
    fs.mkdirSync(plain);

    // Run in a child with git off PATH: the fast path must not need git.
    const script = `const p=require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'paths'))});` +
      `const r=(c)=>{const x=p.locate(c);return x&&[x.mainRoot,x.wtRoot];};` +
      `process.stdout.write(JSON.stringify([r(${JSON.stringify(path.join(main, 'src', 'deep'))}),r(${JSON.stringify(nested)}),r(${JSON.stringify(outside)}),r(${JSON.stringify(plain)})]))`;
    const out = execFileSync(process.execPath, ['-e', script], { env: { ...process.env, PATH: '', Path: '' } }).toString();
    const [deep, nest, out1, none] = JSON.parse(out);
    const same = (a, b) => assert.strictEqual(paths.rel(a, b), '', `${a} vs ${b}`);
    same(deep[0], main); same(deep[1], main);
    same(nest[0], main); same(nest[1], nested);
    assert.strictEqual(out1, null); // needs git, which is unavailable here
    assert.strictEqual(none, null);
    // with git available, the outside worktree resolves through git
    const o = paths.locate(outside);
    same(o.mainRoot, main); same(o.wtRoot, outside);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('rel: a Windows 8.3 short path matches its long form', () => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-longname-directory-')));
  try {
    let short = null;
    if (process.platform === 'win32') {
      try {
        short = execFileSync('cmd', ['/d', '/s', '/c', `"for %I in ("${base}") do @echo %~sI"`],
          { encoding: 'utf8', windowsVerbatimArguments: true }).trim();
      } catch { short = null; }
    }
    if (!short || short === base || !short.includes('~')) return; // no 8.3 names here
    assert.strictEqual(paths.rel(path.join(short, 'src', 'a.js'), base), 'src/a.js');
    assert.strictEqual(paths.rel(path.join(short, 'new', 'missing.js'), base), 'new/missing.js');
    assert.strictEqual(paths.rel(path.join(base, 'x.js'), short), 'x.js');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
