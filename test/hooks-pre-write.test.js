'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const state = require('../lib/state');
const guards = require('../lib/guards');

const root = path.join(__dirname, '..');
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

function repo() {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-pw-')));
  sh(d, 'init', '-q');
  sh(d, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-q', '--allow-empty', '-m', 'i');
  return d;
}
function withRepo(fn) {
  const d = repo();
  try { fn(d); } finally { fs.rmSync(d, { recursive: true, force: true }); }
}
function writeState(d, mutate, config) {
  const f = state.newFeature('x', 'X');
  const st = { version: 1, activeFeature: 'x', features: { x: f } };
  if (mutate) mutate(f);
  fs.mkdirSync(path.join(d, '.playbook'), { recursive: true });
  fs.writeFileSync(path.join(d, '.playbook', 'state.json'), JSON.stringify(st));
  if (config) fs.writeFileSync(path.join(d, '.playbook', 'config.json'), JSON.stringify(config));
}
const approveThrough = (n) => (f) => {
  for (const g of state.GATES.slice(0, n)) f.gates[g].status = 'approved';
};
function hook(input) {
  const r = spawnSync(process.execPath, [path.join(root, 'hooks', 'pre-write.js')], {
    input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const call = (cwd, tool, tool_input) => hook({ hook_event_name: 'PreToolUse', tool_name: tool, cwd, tool_input });
function decision(r) {
  assert.strictEqual(r.code, 0, r.err);
  if (!r.out) return { d: 'allow' };
  const o = JSON.parse(r.out).hookSpecificOutput;
  return { d: o.permissionDecision, reason: o.permissionDecisionReason };
}
const denied = (r, re) => {
  const x = decision(r);
  assert.strictEqual(x.d, 'deny', JSON.stringify(x));
  if (re) assert.match(x.reason, re);
};
const allowed = (r) => assert.strictEqual(decision(r).d, 'allow', r.out);

test('before tasks approved only docs/playbook is writable', () => withRepo((d) => {
  writeState(d, (f) => { f.gates.intent.status = 'approved'; f.gates.spec.status = 'approved'; f.gates.plan.status = 'awaiting-approval'; });
  denied(call(d, 'Write', { file_path: path.join(d, 'src', 'a.js'), content: 'x' }),
    /^Code changes wait for the tasks gate \(current: plan awaiting approval\)$/);
  allowed(call(d, 'Write', { file_path: path.join(d, 'docs', 'playbook', 'x', 'plan.md'), content: 'x' }));
  allowed(call(d, 'Write', { file_path: 'docs/playbook/x/plan.md', content: 'x' }));
}));

test('no state is a no-op', () => withRepo((d) => {
  allowed(call(d, 'Write', { file_path: path.join(d, 'src', 'a.js'), content: 'x' }));
  allowed(call(d, 'Write', { file_path: path.join(d, '.playbook', 'state.json'), content: 'x' }));
}));

test('hash-locked approved doc is denied, unapproved is not', () => withRepo((d) => {
  writeState(d, (f) => { f.gates.intent.status = 'approved'; });
  denied(call(d, 'Edit', { file_path: path.join(d, 'docs', 'playbook', 'x', 'intent.md'), new_string: 'y' }),
    /^intent\.md is approved and locked; ask the user to run \/mint-playbook:reopen intent$/);
  allowed(call(d, 'Edit', { file_path: path.join(d, 'docs', 'playbook', 'x', 'spec.md'), new_string: 'y' }));
}));

test('.playbook is always denied, even before and after tasks', () => withRepo((d) => {
  writeState(d, approveThrough(4));
  for (const p of ['state.json', 'config.json', 'active-task.json', 'approvals/a.json']) {
    denied(call(d, 'Write', { file_path: path.join(d, '.playbook', p), content: '{}' }));
  }
  denied(call(d, 'Write', { file_path: '.playbook\\state.json', content: '{}' }));
}));

test('config.protected globs are denied', () => withRepo((d) => {
  writeState(d, approveThrough(4), { protected: ['infra/**'] });
  denied(call(d, 'Write', { file_path: path.join(d, 'infra', 'main.tf'), content: 'x' }), /protected/);
}));

test('main session after tasks approved: orchestrator does not implement', () => withRepo((d) => {
  writeState(d, approveThrough(4));
  denied(call(d, 'Write', { file_path: path.join(d, 'src', 'a.js'), content: 'x' }),
    /^The orchestrator does not implement; dispatch a builder$/);
  allowed(call(d, 'Write', { file_path: path.join(d, 'docs', 'playbook', 'x', 'review-report.md'), content: 'x' }));
}));

function withWorktree(fn, active) {
  withRepo((d) => {
    writeState(d, approveThrough(4));
    const wt = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-wt-')));
    fs.rmSync(wt, { recursive: true, force: true });
    sh(d, 'worktree', 'add', '-q', '-b', 'playbook/x-t1', wt);
    try {
      if (active) {
        fs.mkdirSync(path.join(wt, '.playbook'), { recursive: true });
        fs.writeFileSync(path.join(wt, '.playbook', 'active-task.json'), JSON.stringify(active));
      }
      fn(d, wt);
    } finally {
      try { sh(d, 'worktree', 'remove', '--force', wt); } catch { /* ignore */ }
      fs.rmSync(wt, { recursive: true, force: true });
    }
  });
}
const ACTIVE = { id: 'T1', kind: 'task', owns: ['src/api/**'], shared: ['CHANGELOG.md'], lockedTests: [] };

test('builder worktree: owns allowed, others denied naming task, shared allowed', () => withWorktree((d, wt) => {
  allowed(bcall(wt, 'Write', { file_path: path.join(wt, 'src', 'api', 'x.js'), content: 'x' }));
  denied(bcall(wt, 'Write', { file_path: path.join(wt, 'src', 'ui', 'y.js'), content: 'x' }), /T1.*src\/api\/\*\*/);
  allowed(bcall(wt, 'Edit', { file_path: path.join(wt, 'CHANGELOG.md'), new_string: 'x' }));
  allowed(bcall(wt, 'Write', { file_path: 'src/api/z.js', content: 'x' }));
  denied(bcall(wt, 'Write', { file_path: path.join(wt, '.playbook', 'active-task.json'), content: '{}' }));
}, ACTIVE));

test('builder worktree without active task', () => withWorktree((d, wt) => {
  denied(bcall(wt, 'Write', { file_path: path.join(wt, 'src', 'a.js'), content: 'x' }),
    /^Run playbook\.js task start <id> in this worktree before editing$/);
}));

test('H3 locked test for bugfix', () => withWorktree((d, wt) => {
  denied(bcall(wt, 'Edit', { file_path: path.join(wt, 'test', 'api', 'a.test.js'), new_string: 'x' }),
    /^fix the code, not the test \(test\/api\/a\.test\.js is locked for this bug fix\)$/);
  allowed(bcall(wt, 'Edit', { file_path: path.join(wt, 'src', 'api', 'a.js'), new_string: 'x' }));
}, { ...ACTIVE, kind: 'bugfix', owns: ['src/api/**', 'test/**'], lockedTests: ['test/api/a.test.js'] }));

test('outside the repo is always allowed (scratchpad, ~/.claude)', () => withRepo((d) => {
  writeState(d, (f) => { f.gates.intent.status = 'awaiting-approval'; });
  const out = path.join(os.tmpdir(), 'pb-outside-scratch', 'n.txt');
  allowed(call(d, 'Write', { file_path: out, content: 'x' }));
  allowed(call(d, 'Write', { file_path: path.join(os.homedir(), '.claude', 'x.md'), content: 'x' }));
}));

test('drive-letter case differs from root (win32)', { skip: process.platform !== 'win32' }, () => withRepo((d) => {
  writeState(d, (f) => { f.gates.intent.status = 'awaiting-approval'; });
  const flipped = d[0] === d[0].toUpperCase() ? d[0].toLowerCase() + d.slice(1) : d[0].toUpperCase() + d.slice(1);
  denied(call(d, 'Write', { file_path: path.join(flipped, 'src', 'a.js'), content: 'x' }), /Code changes wait/);
  denied(call(d, 'Write', { file_path: flipped + '\\.playbook\\state.json', content: 'x' }));
}));

test('H4 content secrets', () => withRepo((d) => {
  writeState(d, (f) => { f.gates.intent.status = 'awaiting-approval'; });
  const f = path.join(d, 'docs', 'playbook', 'x', 'spec.md');
  denied(call(d, 'Write', { file_path: f, content: 'key AKIA' + 'ABCDEFGHIJKLMNOP' }), /secret/i);
  denied(call(d, 'Edit', { file_path: f, new_string: '-----BEGIN RSA PRIVATE KEY-----' }), /secret/i);
  denied(call(d, 'MultiEdit', { file_path: f, edits: [{ new_string: 'ok' }, { new_string: 'ghp_' + 'a'.repeat(36) }] }), /secret/i);
  allowed(call(d, 'Write', { file_path: f, content: 'nothing here' }));
}));

test('H4 Read of env and secrets', () => withRepo((d) => {
  writeState(d, (f) => { f.gates.intent.status = 'awaiting-approval'; });
  denied(call(d, 'Read', { file_path: path.join(d, '.env') }), /\.env/);
  denied(call(d, 'Read', { file_path: path.join(d, 'app', '.env.local') }));
  denied(call(d, 'Read', { file_path: path.join(d, 'secrets', 'k.pem') }));
  allowed(call(d, 'Read', { file_path: path.join(d, '.env.example') }));
  allowed(call(d, 'Read', { file_path: path.join(d, 'src', 'a.js') }));
  allowed(call(d, 'Read', { file_path: path.join(d, '.playbook', 'state.json') }));
}));

test('unit: decide functions', () => {
  assert.strictEqual(guards.decideTestEdit({ relWt: 'a.js', activeTask: null }), null);
  assert.strictEqual(guards.decideTestEdit({ relWt: 'test\\a.js', activeTask: { kind: 'bugfix', lockedTests: ['test/a.js'] } }),
    'fix the code, not the test (test/a.js is locked for this bug fix)');
  assert.strictEqual(guards.decideTestEdit({ relWt: 'test/a.js', activeTask: { kind: 'task', lockedTests: ['test/a.js'] } }), null);
  assert.ok(guards.decideSecrets({ toolName: 'Write', relMain: 'a.js', content: 'xoxb-1234567890-abc' }));
  assert.ok(guards.decideSecrets({ toolName: 'Write', relMain: 'a.js', content: 'sk-' + 'a'.repeat(32) }));
  assert.strictEqual(guards.decideSecrets({ toolName: 'Read', relMain: '.env.sample' }), null);
  assert.strictEqual(guards.decideSecrets({ toolName: 'Write', relMain: '.env', content: 'A=1' }), null);
  const st = { features: { x: state.newFeature('x') } };
  assert.strictEqual(guards.decideWrite({ relMain: 'src\\a.js', relWt: 'src\\a.js', inMainSession: true, state: st, slug: 'x', activeTask: null, config: {} }),
    'Code changes wait for the tasks gate (current: intent pending)');
  assert.strictEqual(guards.decideWrite({ relMain: null, relWt: null, inMainSession: true, state: st, slug: 'x' }), null);
});

test('internal error: deny under .playbook, allow elsewhere', () => withRepo((d) => {
  writeState(d);
  fs.writeFileSync(path.join(d, '.playbook', 'state.json'), '{bad');
  allowed(call(d, 'Write', { file_path: path.join(d, 'src', 'a.js'), content: 'x' }));
  denied(hook('{"tool_name":"Write","cwd":"' + d.replace(/\\/g, '\\\\') + '","tool_input":{"file_path":".playbook/state.json"}'));
  allowed(hook('not json'));
}));

// ---- fix round 1 ----
function withNestedWorktree(fn, active, mutate) {
  withRepo((d) => {
    writeState(d, mutate || approveThrough(4));
    const wt = path.join(d, '.claude', 'worktrees', 'agent-x');
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    sh(d, 'worktree', 'add', '-q', '-b', 'playbook/x-t2', wt);
    try {
      if (active !== null) {
        fs.mkdirSync(path.join(wt, '.playbook'), { recursive: true });
        fs.writeFileSync(path.join(wt, '.playbook', 'active-task.json'), active === 'corrupt' ? '{bad' : JSON.stringify(active || ACTIVE));
      }
      fn(d, wt);
    } finally {
      try { sh(d, 'worktree', 'remove', '--force', wt); } catch { /* ignore */ }
    }
  });
}

test('corrupt state.json: deny .playbook writes only (well-formed stdin)', () => withRepo((d) => {
  writeState(d);
  fs.writeFileSync(path.join(d, '.playbook', 'state.json'), '{bad');
  denied(call(d, 'Write', { file_path: path.join(d, '.playbook', 'state.json'), content: '{}' }), /unreadable/);
  denied(call(d, 'Edit', { file_path: '.playbook/config.json', new_string: '{}' }));
  allowed(call(d, 'Write', { file_path: path.join(d, 'src', 'a.js'), content: 'x' }));
  allowed(call(d, 'Read', { file_path: path.join(d, '.playbook', 'state.json') }));
}));

test('corrupt state.json: worktree .playbook denied too', () => withNestedWorktree((d, wt) => {
  fs.writeFileSync(path.join(d, '.playbook', 'state.json'), '{bad');
  denied(bcall(wt, 'Write', { file_path: path.join(wt, '.playbook', 'active-task.json'), content: '{}' }));
  allowed(bcall(wt, 'Write', { file_path: path.join(wt, 'src', 'a.js'), content: 'x' }));
}));

test('nested worktree (<main>/.claude/worktrees/agent-x): owns, shared, deny', () => withNestedWorktree((d, wt) => {
  allowed(bcall(wt, 'Write', { file_path: path.join(wt, 'src', 'api', 'x.js'), content: 'x' }));
  allowed(bcall(wt, 'Edit', { file_path: path.join(wt, 'CHANGELOG.md'), new_string: 'x' }));
  denied(bcall(wt, 'Write', { file_path: path.join(wt, 'src', 'ui', 'y.js'), content: 'x' }), /T1/);
  denied(bcall(wt, 'Write', { file_path: path.join(wt, '.playbook', 'active-task.json'), content: '{}' }));
  // main checkout is off limits even where owns would match
  denied(bcall(wt, 'Write', { file_path: path.join(d, 'src', 'api', 'x.js'), content: 'x' }), /outside this task's worktree/);
  denied(bcall(wt, 'Write', { file_path: path.join(d, '.playbook', 'state.json'), content: '{}' }));
}));

test('main session cannot write into a nested worktree path', () => withNestedWorktree((d) => {
  denied(call(d, 'Write', { file_path: path.join(d, '.claude', 'worktrees', 'agent-x', 'src', 'api', 'x.js'), content: 'x' }),
    /orchestrator does not implement/);
}));

test('builder cannot use docs/playbook exemption after tasks approved', () => withNestedWorktree((d, wt) => {
  denied(bcall(wt, 'Write', { file_path: path.join(wt, 'docs', 'playbook', 'x', 'review-report.md'), content: 'x' }), /T1/);
}));

test('builder with owned docs glob may write them', () => withNestedWorktree((d, wt) => {
  allowed(bcall(wt, 'Write', { file_path: path.join(wt, 'docs', 'playbook', 'x', 'notes.md'), content: 'x' }));
}, { ...ACTIVE, owns: ['docs/playbook/x/notes.md'] }));

test('corrupt active-task.json behaves as missing', () => withNestedWorktree((d, wt) => {
  denied(bcall(wt, 'Write', { file_path: path.join(wt, 'src', 'api', 'x.js'), content: 'x' }), /task start/);
}, 'corrupt'));

test('path traversal is resolved before matching', () => withRepo((d) => {
  writeState(d, (f) => { f.gates.intent.status = 'awaiting-approval'; });
  denied(call(d, 'Write', { file_path: path.join(d, 'docs', 'playbook') + '/../.playbook/state.json', content: 'x' }));
  denied(call(d, 'Write', { file_path: path.join(d, 'docs', 'playbook') + '/../src/a.js', content: 'x' }), /Code changes wait/);
  denied(call(d, 'Write', { file_path: 'docs/playbook/../.playbook/state.json', content: 'x' }));
}));

test('NotebookEdit new_source secrets are denied', () => withRepo((d) => {
  writeState(d, (f) => { f.gates.intent.status = 'awaiting-approval'; });
  denied(call(d, 'NotebookEdit', { notebook_path: path.join(d, 'docs', 'playbook', 'x', 'n.ipynb'), new_source: 'k = "AKIA' + 'ABCDEFGHIJKLMNOP"' }), /secret/i);
  allowed(call(d, 'NotebookEdit', { notebook_path: path.join(d, 'docs', 'playbook', 'x', 'n.ipynb'), new_source: 'print(1)' }));
}));

test('check order: secrets beat gate message', () => withRepo((d) => {
  writeState(d, (f) => { f.gates.intent.status = 'awaiting-approval'; });
  denied(call(d, 'Write', { file_path: path.join(d, 'src', 'a.js'), content: 'AKIA' + 'ABCDEFGHIJKLMNOP' }), /secret/i);
}));

test('NTFS aliases cannot dodge matching (win32)', { skip: process.platform !== 'win32' }, () => withRepo((d) => {
  writeState(d, (f) => { f.gates.intent.status = 'approved'; });
  denied(call(d, 'Write', { file_path: path.join(d, '.playbook.', 'state.json'), content: 'x' }), /playbook state/);
  denied(call(d, 'Write', { file_path: path.join(d, 'docs', 'playbook', 'x') + path.sep + 'intent.md::$DATA', content: 'x' }), /locked/);
  denied(call(d, 'Write', { file_path: path.join(d, 'docs', 'playbook', 'x') + path.sep + 'intent.md. ', content: 'x' }), /locked/);
}));

test('unit: decideWrite builder outside own worktree', () => {
  const st = { features: { x: state.newFeature('x') } };
  for (const g of state.GATES.slice(0, 4)) st.features.x.gates[g].status = 'approved';
  assert.strictEqual(guards.decideWrite({ relMain: 'src/api/x.js', relWt: null, inMainSession: false, state: st, slug: 'x', activeTask: ACTIVE, config: {} }),
    "src/api/x.js is outside this task's worktree");
});

// ---- final review fixes ----
const bcall = (cwd, tool, tool_input) => hook({ hook_event_name: 'PreToolUse', tool_name: tool, cwd, agent_id: 'a1b2c3', agent_type: 'mint-playbook:builder', tool_input });
const allDone = (f) => {
  for (const g of state.GATES) f.gates[g].status = 'approved';
  f.tasks = { T0: { status: 'done', attempts: 0 }, T1: { status: 'done', attempts: 0 } };
};

test('post-done: a finished feature allows normal main-session writes', () => withRepo((d) => {
  writeState(d, allDone, { protected: ['infra/**'] });
  allowed(call(d, 'Write', { file_path: path.join(d, 'src', 'x.js'), content: 'x' }));
  // always-deny, secrets stay on
  denied(call(d, 'Write', { file_path: path.join(d, '.playbook', 'state.json'), content: '{}' }));
  denied(call(d, 'Write', { file_path: path.join(d, 'infra', 'main.tf'), content: 'x' }), /protected/);
  denied(call(d, 'Write', { file_path: path.join(d, 'docs', 'playbook', 'x', 'spec.md'), content: 'x' }), /locked/);
  denied(call(d, 'Write', { file_path: path.join(d, 'src', 'y.js'), content: 'AKIA' + 'ABCDEFGHIJKLMNOP' }), /secret/i);
}));

test('in flight: all gates approved but a task not done still gates the main session', () => withRepo((d) => {
  writeState(d, (f) => { allDone(f); f.tasks.T1.status = 'in-progress'; });
  denied(call(d, 'Write', { file_path: path.join(d, 'src', 'x.js'), content: 'x' }), /orchestrator does not implement/);
}));

test('no active feature (feature use --none) allows main-session writes', () => withRepo((d) => {
  writeState(d, approveThrough(4));
  const file = path.join(d, '.playbook', 'state.json');
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  st.activeFeature = null;
  fs.writeFileSync(file, JSON.stringify(st));
  allowed(call(d, 'Write', { file_path: path.join(d, 'src', 'x.js'), content: 'x' }));
  denied(call(d, 'Write', { file_path: path.join(d, '.playbook', 'config.json'), content: '{}' }));
}));

test('release/approved-changes.json is always denied to the agent', () => withRepo((d) => {
  writeState(d, allDone);
  denied(call(d, 'Write', { file_path: path.join(d, 'release', 'approved-changes.json'), content: '[]' }), /release manager/);
  denied(call(d, 'Edit', { file_path: 'release/approved-changes.json', new_string: 'x' }), /release manager/);
  allowed(call(d, 'Read', { file_path: path.join(d, 'release', 'approved-changes.json') }));
  assert.match(guards.decideAlwaysDeny({ relMain: 'release/approved-changes.json', relWt: null, state: null, slug: null, config: {} }), /release manager/);
}));

test('a user session in their own linked worktree (no agent_id) is the main session', () => withNestedWorktree((d, wt) => {
  // no active task: a builder would be told to run task start; the main session is told not to implement
  denied(call(wt, 'Write', { file_path: path.join(wt, 'src', 'api', 'x.js'), content: 'x' }), /orchestrator does not implement/);
  allowed(call(wt, 'Write', { file_path: path.join(wt, 'docs', 'playbook', 'x', 'review-report.md'), content: 'x' }));
  // the same call from a subagent (agent_id present) is a builder
  denied(bcall(wt, 'Write', { file_path: path.join(wt, 'src', 'api', 'x.js'), content: 'x' }), /task start/);
}, null));

test('a subagent working in the main checkout is not treated as a builder', () => withRepo((d) => {
  writeState(d, (f) => { f.gates.intent.status = 'approved'; });
  allowed(bcall(d, 'Write', { file_path: path.join(d, 'docs', 'playbook', 'x', 'spec.md'), content: 'x' }));
}));

test('user linked worktree after the feature is done: normal writes', () => withNestedWorktree((d, wt) => {
  allowed(call(wt, 'Write', { file_path: path.join(wt, 'src', 'ui', 'y.js'), content: 'x' }));
}, null, allDone));
