'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readFrontmatter } = require('./helpers/frontmatter.js');
const glob = require('../lib/glob.js');

const ROOT = path.join(__dirname, '..');
const T = path.join(ROOT, 'skills', 'evals', 'templates');
const { outsideMayChange, formatResult } = require(path.join(T, 'evals', 'check.js'));

test('outsideMayChange returns changed files not covered by may_change', () => {
  assert.deepEqual(outsideMayChange(['src/a.js', 'README.md'], ['src/**']), ['README.md']);
  assert.deepEqual(outsideMayChange(['src/a.js', 'test/a.test.js'], ['src/**', 'test/**']), []);
  assert.deepEqual(outsideMayChange([], ['src/**']), []);
  assert.deepEqual(outsideMayChange(['a.js'], []), ['a.js']);
  assert.deepEqual(outsideMayChange(['a.js'], undefined), ['a.js']);
});

test('outsideMayChange normalises backslashes', () => {
  const bs = String.fromCharCode(92);
  assert.deepEqual(outsideMayChange([['src', 'lib', 'a.js'].join(bs)], ['src/**']), []);
  assert.deepEqual(outsideMayChange([['docs', 'a.md'].join(bs)], ['src/**']), ['docs/a.md']);
});

test('outsideMayChange agrees with lib/glob.js', () => {
  const patterns = ['src/**', '*.md', 'src/*.js', '**/*.test.js', 'a?.js', 'docs/**/x.md', 'a.b+c', 'src/(x)/*'];
  const files = ['src/a.js', 'src/x/a.js', 'README.md', 'docs/README.md', 'a1.js', 'a/b.test.js', 'x.test.js',
    'docs/x.md', 'docs/y/z/x.md', 'a.b+c', 'axb+c', 'src/(x)/f', 'src/x/f', 'lib/Src/a.js'];
  const nocase = process.platform === 'win32';
  for (const p of patterns) {
    for (const f of files) {
      const expected = !glob.match(p, f, { nocase });
      assert.equal(outsideMayChange([f], [p]).length === 1, expected, `${p} vs ${f}`);
    }
  }
});

test('formatResult prints PASS and FAIL lines', () => {
  assert.equal(formatResult('login', true, 5), 'PASS login (5/5 checks)');
  assert.equal(formatResult('login', false, 5, 4), 'FAIL login (4/5 checks)');
  assert.equal(formatResult('x', false, 5), 'FAIL x (0/5 checks)');
});

test('example eval has the required fields', () => {
  const e = JSON.parse(fs.readFileSync(path.join(T, 'evals', 'example-eval.json'), 'utf8'));
  for (const k of ['name', 'source', 'from', 'prompt', 'may_change', 'checks']) assert.ok(k in e, k);
  assert.ok(Array.isArray(e.may_change) && Array.isArray(e.checks));
  assert.ok(e.checks.every((c) => typeof c.run === 'string'));
});

test('run-evals.js can be required without running, never uses --bare', () => {
  const src = fs.readFileSync(path.join(T, 'evals', 'run-evals.js'), 'utf8');
  assert.match(src, /require\.main === module/);
  assert.ok(!/--bare/.test(src.replace(/never[^\n]*--bare[^\n]*/gi, '')), 'no --bare flag');
  assert.doesNotThrow(() => require(path.join(T, 'evals', 'run-evals.js')));
});

test('evals workflow triggers on the right paths and a schedule', () => {
  const y = fs.readFileSync(path.join(T, 'workflows', 'evals.yml'), 'utf8');
  for (const p of ["'CLAUDE.md'", "'.claude/**'", "'evals/**'"]) assert.ok(y.includes(p), p);
  assert.match(y, /^\s*schedule:/m);
  assert.match(y, /cron:/);
  assert.match(y, /fetch-depth: 0/);
  assert.match(y, /@anthropic-ai\/claude-code/);
  assert.match(y, /node evals\/run-evals\.js/);
  assert.match(y, /ANTHROPIC_API_KEY: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}/);
});

test('evals skill has frontmatter and covers the essentials', () => {
  const f = path.join(ROOT, 'skills', 'evals', 'SKILL.md');
  const fm = readFrontmatter(f);
  assert.equal(fm.name, 'evals');
  assert.ok(fm.description && !/\n/.test(fm.description));
  const text = fs.readFileSync(f, 'utf8');
  for (const s of ['20', 'incident', 'may_change', '.github/workflows/evals.yml', 'node evals/run-evals.js']) {
    assert.ok(text.includes(s), s);
  }
});
