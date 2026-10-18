'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const store = require('../lib/store');

function tmpdir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'pb-')); }

test('readJson fallback, valid, invalid', () => {
  const d = tmpdir();
  try {
    const f = path.join(d, 'a.json');
    assert.deepStrictEqual(store.readJson(f, { x: 1 }), { x: 1 });
    fs.writeFileSync(f, '{"a":2}');
    assert.deepStrictEqual(store.readJson(f, null), { a: 2 });
    fs.writeFileSync(f, '{bad');
    assert.throws(() => store.readJson(f, null), (e) => e instanceof store.StoreError && e.file === f);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('writeJsonAtomic creates dirs, leaves no temp files', () => {
  const d = tmpdir();
  try {
    const f = path.join(d, 'sub', 'a.json');
    store.writeJsonAtomic(f, { k: [1, 2] });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { k: [1, 2] });
    store.writeJsonAtomic(f, { k: 3 });
    assert.deepStrictEqual(store.readJson(f), { k: 3 });
    assert.deepStrictEqual(fs.readdirSync(path.dirname(f)), ['a.json']);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('withLock returns result, releases lock, releases on throw, breaks stale lock', () => {
  const d = tmpdir();
  try {
    const f = path.join(d, 'a.json');
    assert.strictEqual(store.withLock(f, () => 42), 42);
    assert.strictEqual(fs.existsSync(f + '.lock'), false);
    assert.throws(() => store.withLock(f, () => { throw new Error('boom'); }), /boom/);
    assert.strictEqual(fs.existsSync(f + '.lock'), false);
    fs.writeFileSync(f + '.lock', '');
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(f + '.lock', old, old);
    assert.strictEqual(store.withLock(f, () => 'ok'), 'ok');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('withLock serialises 8 processes x 25 increments', async () => {
  const d = tmpdir();
  try {
    const f = path.join(d, 'counter.json');
    fs.writeFileSync(f, '{"n":0}');
    const script = path.join(d, 'worker.js');
    fs.writeFileSync(script, `
      const store = require(${JSON.stringify(path.resolve(__dirname, '../lib/store'))});
      const f = ${JSON.stringify(f)};
      for (let i = 0; i < 25; i++) store.withLock(f, () => {
        const c = store.readJson(f, { n: 0 });
        store.writeJsonAtomic(f, { n: c.n + 1 });
      });
    `);
    const codes = await Promise.all(Array.from({ length: 8 }, () => new Promise((res) => {
      const p = spawn(process.execPath, [script], { stdio: 'inherit' });
      p.on('exit', res);
    })));
    assert.deepStrictEqual(codes, new Array(8).fill(0));
    assert.strictEqual(store.readJson(f).n, 200);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
