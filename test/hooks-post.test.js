'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const state = require('../lib/state');
const tasks = require('../lib/tasks');

const root = path.join(__dirname, '..');
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

// Main repo with state (+config) and a linked worktree with an active task.
function setup(config, { activeTask = {} } = {}) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-post-')));
  const main = path.join(base, 'main');
  const wt = path.join(base, 'wt');
  fs.mkdirSync(main);
  sh(main, 'init', '-q');
  sh(main, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-q', '--allow-empty', '-m', 'i');
  sh(main, 'worktree', 'add', '-q', '-b', 'b1', wt);
  const f = state.newFeature('x', 'X');
  fs.mkdirSync(path.join(main, '.playbook'), { recursive: true });
  fs.writeFileSync(path.join(main, '.playbook', 'state.json'), JSON.stringify({ version: 1, activeFeature: 'x', features: { x: f } }));
  if (config) fs.writeFileSync(path.join(main, '.playbook', 'config.json'), JSON.stringify(config));
  if (activeTask) {
    fs.mkdirSync(path.join(wt, '.playbook'), { recursive: true });
    fs.writeFileSync(path.join(wt, '.playbook', 'active-task.json'),
      JSON.stringify({ id: 'T1', lockedTests: [], lastEditAt: null, proofs: [], ...activeTask }));
  }
  return { base, main, wt, done: () => fs.rmSync(base, { recursive: true, force: true }) };
}
const activeOf = (wt) => JSON.parse(fs.readFileSync(path.join(wt, '.playbook', 'active-task.json'), 'utf8'));
function run(hookFile, input) {
  const r = spawnSync(process.execPath, [path.join(root, 'hooks', hookFile)], { input: JSON.stringify(input), encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const edit = (cwd, file) => run('post-edit.js', { hook_event_name: 'PostToolUse', tool_name: 'Edit', cwd, tool_input: { file_path: file } });
const stop = (cwd, extra) => run('subagent-stop.js', { hook_event_name: 'SubagentStop', cwd, stop_hook_active: false, ...extra });

test('lint failure exits 2 with linter text', () => {
  const s = setup({ lint: `node -e "console.error('bad style');process.exit(1)" {file}` });
  try {
    const r = edit(s.wt, path.join(s.wt, 'a.js'));
    assert.strictEqual(r.code, 2);
    assert.match(r.err, /^lint failed for a\.js:\n/);
    assert.match(r.err, /bad style/);
  } finally { s.done(); }
});

test('lint pass and no lint config exit 0', () => {
  let s = setup({ lint: `node -e "console.log('ok')" {file}` });
  try { assert.strictEqual(edit(s.wt, path.join(s.wt, 'a.js')).code, 0); } finally { s.done(); }
  s = setup(null);
  try { assert.strictEqual(edit(s.wt, path.join(s.wt, 'a.js')).code, 0); } finally { s.done(); }
});

test('{file} is double-quoted so paths with spaces work; appended when absent', () => {
  const s = setup({ lint: `node -e "process.exit(process.argv[1].includes('my dir')?0:1)" {file}` });
  try {
    const dir = path.join(s.wt, 'my dir');
    fs.mkdirSync(dir);
    assert.strictEqual(edit(s.wt, path.join(dir, 'a.js')).code, 0);
  } finally { s.done(); }
  const s2 = setup({ lint: 'node -e "process.exit(process.argv.length>1?1:0)"' });
  try { assert.strictEqual(edit(s2.wt, path.join(s2.wt, 'a.js')).code, 2); } finally { s2.done(); }
});

test('already double-quoted "{file}" is not double-quoted again', () => {
  const s = setup({ lint: `node -e "process.exit(require('fs').existsSync(process.argv[1])?0:1)" "{file}"` });
  try {
    const dir = path.join(s.wt, 'my dir');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'x.js'), '');
    const r = edit(s.wt, path.join(dir, 'x.js'));
    assert.strictEqual(r.code, 0, r.err);
  } finally { s.done(); }
});

test('no state is a no-op', () => {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-post-n-')));
  try {
    sh(d, 'init', '-q');
    assert.strictEqual(edit(d, path.join(d, 'a.js')).code, 0);
    assert.strictEqual(stop(d).out, '');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('lastEditAt is set in a worktree, even when lint fails', () => {
  const s = setup({ lint: 'node -e "process.exit(1)"' });
  try {
    assert.strictEqual(activeOf(s.wt).lastEditAt, null);
    edit(s.wt, path.join(s.wt, 'a.js'));
    assert.ok(Date.parse(activeOf(s.wt).lastEditAt) > 0);
  } finally { s.done(); }
});

test('main session edit does not touch any active-task.json', () => {
  const s = setup(null);
  try {
    assert.strictEqual(edit(s.main, path.join(s.main, 'a.js')).code, 0);
    assert.strictEqual(fs.existsSync(path.join(s.main, '.playbook', 'active-task.json')), false);
  } finally { s.done(); }
});

test('checkProof reasons', () => {
  assert.deepStrictEqual(tasks.checkProof({ proofs: [] }), { ok: false, reason: 'no proof run' });
  assert.deepStrictEqual(tasks.checkProof({ proofs: [{ at: '2026-01-01T00:00:01Z', exit: 3 }] }), { ok: false, reason: 'last proof failed (exit 3)' });
  assert.deepStrictEqual(tasks.checkProof({ lastEditAt: '2026-01-01T00:00:05Z', proofs: [{ at: '2026-01-01T00:00:01Z', exit: 0 }] }), { ok: false, reason: 'edited after last proof' });
  assert.deepStrictEqual(tasks.checkProof({ lastEditAt: '2026-01-01T00:00:01Z', proofs: [{ at: '2026-01-01T00:00:05Z', exit: 0 }] }), { ok: true });
});

test('SubagentStop blocks without a fresh passing proof', () => {
  const s = setup(null, { activeTask: { lastEditAt: '2026-01-01T00:00:05Z', proofs: [{ at: '2026-01-01T00:00:01Z', exit: 0 }] } });
  try {
    const r = stop(s.wt);
    assert.strictEqual(r.code, 0);
    const o = JSON.parse(r.out);
    assert.strictEqual(o.decision, 'block');
    assert.ok(o.reason.startsWith('Run `node "'));
    assert.ok(o.reason.includes(path.join(root, 'bin', 'playbook.js')));
    assert.ok(o.reason.includes('proof` and paste the output before finishing.'));
    assert.ok(o.reason.includes('(edited after last proof)'));
  } finally { s.done(); }
});

test('SubagentStop allows: stop_hook_active, passing proof, main session, corrupt, no task', () => {
  let s = setup(null, { activeTask: { proofs: [] } });
  try { assert.strictEqual(stop(s.wt, { stop_hook_active: true }).out, ''); } finally { s.done(); }
  s = setup(null, { activeTask: { lastEditAt: '2026-01-01T00:00:01Z', proofs: [{ at: '2026-01-01T00:00:05Z', exit: 0 }] } });
  try {
    assert.strictEqual(stop(s.wt).out, '');
    assert.strictEqual(stop(s.main).out, '');
    fs.writeFileSync(path.join(s.wt, '.playbook', 'active-task.json'), '{nope');
    assert.strictEqual(stop(s.wt).out, '');
  } finally { s.done(); }
  s = setup(null, { activeTask: null });
  try { assert.strictEqual(stop(s.wt).out, ''); } finally { s.done(); }
});

// ---- final review fixes ----
test('lint is skipped under docs/playbook and outside the worktree', () => {
  const s = setup({ lint: 'node -e "process.exit(1)"' });
  try {
    assert.strictEqual(edit(s.wt, path.join(s.wt, 'docs', 'playbook', 'x', 'spec.md')).code, 0);
    assert.strictEqual(edit(s.wt, path.join(s.base, 'elsewhere', 'n.txt')).code, 0);
    assert.strictEqual(edit(s.main, path.join(s.wt, 'a.js')).code, 0); // outside the main checkout's worktree
    assert.strictEqual(edit(s.wt, path.join(s.wt, 'a.js')).code, 2);
  } finally { s.done(); }
});

test('the file path is never interpolated by the shell', () => {
  const rec = `node -e "require('fs').writeFileSync('seen.txt', String(process.argv[1]))" {file}`;
  const s = setup({ lint: rec });
  try {
    const name = 'x%OS%$HOME`id`.js';
    const r = edit(s.wt, path.join(s.wt, name));
    assert.strictEqual(r.code, 0, r.err);
    const seen = path.join(s.wt, 'seen.txt');
    if (fs.existsSync(seen)) assert.strictEqual(fs.readFileSync(seen, 'utf8'), name);
    else assert.match(r.err, /lint skipped/);
  } finally { s.done(); }
  const s2 = setup({ lint: 'node -e "process.exit(process.env.PLAYBOOK_FILE.endsWith(\'b.js\') && process.argv.length === 1 ? 1 : 0)"' });
  try {
    // PLAYBOOK_FILE is set and nothing is appended when the template uses it
    assert.strictEqual(edit(s2.wt, path.join(s2.wt, 'b.js')).code, 2);
  } finally { s2.done(); }
});

test('SubagentStop is a no-op without playbook state', () => {
  const s = setup(null, { activeTask: { proofs: [] } });
  try {
    assert.strictEqual(JSON.parse(stop(s.wt).out).decision, 'block');
    fs.rmSync(path.join(s.main, '.playbook', 'state.json'));
    assert.strictEqual(stop(s.wt).out, '');
  } finally { s.done(); }
});
