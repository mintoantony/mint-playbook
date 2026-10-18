'use strict';
const test = require('node:test');
const assert = require('node:assert');
const glob = require('../lib/glob');

test('match basics', () => {
  assert.strictEqual(glob.match('src/**', 'src/a/b.js'), true);
  assert.strictEqual(glob.match('src/*.js', 'src/a/b.js'), false);
  assert.strictEqual(glob.match('src/*.js', 'src/b.js'), true);
  assert.strictEqual(glob.match('test/**/*.test.js', 'test/x.test.js'), true);
  assert.strictEqual(glob.match('test/**/*.test.js', 'test/a/b/x.test.js'), true);
  assert.strictEqual(glob.match('a?c', 'abc'), true);
  assert.strictEqual(glob.match('a?c', 'a/c'), false);
  assert.strictEqual(glob.match('package.json', 'package-json'), false);
  assert.strictEqual(glob.match('src/**', 'other/a.js'), false);
});

test('nocase', () => {
  assert.strictEqual(glob.match('SRC/**', 'src/a.js'), false);
  assert.strictEqual(glob.match('SRC/**', 'src/a.js', { nocase: true }), true);
});

test('matchAny', () => {
  assert.strictEqual(glob.matchAny(['a/*', 'b/**'], 'b/c/d'), true);
  assert.strictEqual(glob.matchAny(['a/*'], 'b/c'), false);
  assert.strictEqual(glob.matchAny([], 'x'), false);
});
