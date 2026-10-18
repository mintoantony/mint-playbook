'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const tasksLib = require('../tasks');
const state = require('../state');
const { rel, stateDir, featureDir, worktreeRoot } = require('../paths');
const { readJson, writeJsonAtomic, withLock } = require('../store');
const { fail, parseArgs, requireRoot, requireState, resolveSlug } = require('./common');

const STATUSES = ['todo', 'dispatched', 'in-progress', 'done', 'failed', 'blocked'];

function docFile(root, slug, name) {
  return path.join(featureDir(root, slug), name);
}

// Parsed tasks.md plus the feature's extraTasks. Always read from the main root.
function loadList(root, slug, f) {
  const file = docFile(root, slug, 'tasks.md');
  let parsed = { tasks: [], errors: [] };
  let exists = false;
  if (fs.existsSync(file)) {
    exists = true;
    parsed = tasksLib.parse(fs.readFileSync(file, 'utf8'));
  }
  const extras = (f.extraTasks || []).map((t) => ({
    covers: [], depends_on: [], owns: [], shared: [], kind: 'task', title: '', ...t,
  }));
  return { tasks: parsed.tasks.concat(extras), errors: parsed.errors, exists };
}

function ctxFor(args, ctx) {
  const { pos, flags } = parseArgs(args);
  const root = requireRoot(ctx.cwd);
  const st = requireState(root);
  const slug = resolveSlug(st, flags);
  return { pos, flags, root, st, slug, f: st.features[slug] };
}

function reportErrors(ctx, errs) {
  for (const e of errs) ctx.stderr.write(e.line ? `tasks.md:${e.line}: ${e.msg}\n` : `tasks.md: ${e.msg}\n`);
}

function specIds(root, slug) {
  const p = docFile(root, slug, 'spec.md');
  return fs.existsSync(p) ? tasksLib.requirementIds(fs.readFileSync(p, 'utf8')) : [];
}

function validateCmd(args, ctx) {
  const { root, slug, f } = ctxFor(args, ctx);
  const list = loadList(root, slug, f);
  if (!list.exists) {
    reportErrors(ctx, [{ msg: `not found at ${rel(docFile(root, slug, 'tasks.md'), root)}` }]);
    return 1;
  }
  const errs = list.errors.length ? list.errors : tasksLib.validate(list.tasks, specIds(root, slug));
  if (errs.length) {
    reportErrors(ctx, errs);
    return 1;
  }
  state.update(root, (st) => {
    const tf = st.features[slug].tasks;
    for (const t of list.tasks) if (!tf[t.id]) tf[t.id] = { status: 'todo', attempts: 0 };
  });
  ctx.stdout.write(`tasks: ok (${list.tasks.length} tasks, ${tasksLib.waves(list.tasks).length} waves)\n`);
  return 0;
}

function tasks(args, ctx) {
  if (args[0] === 'validate') return validateCmd(args.slice(1), ctx);
  fail('usage: tasks validate');
  return 1;
}

function wavesCmd(args, ctx) {
  const { flags, root, slug, f } = ctxFor(args, ctx);
  const list = loadList(root, slug, f);
  if (!list.exists && !list.tasks.length) fail('tasks.md not found');
  if (list.errors.length) {
    reportErrors(ctx, list.errors);
    return 1;
  }
  if (flags.next) {
    const cfg = readJson(path.join(stateDir(root), 'config.json'), {}) || {};
    let limit = cfg.concurrency || 3;
    if (flags.limit !== undefined) {
      limit = Number(flags.limit);
      if (!Number.isInteger(limit) || limit < 1) fail('--limit must be a positive integer');
    }
    const ids = tasksLib.nextWave(list.tasks, f.tasks, limit);
    ctx.stdout.write(flags.json ? JSON.stringify(ids) + '\n' : `next: ${ids.length ? ids.join(', ') : 'none'}\n`);
    return 0;
  }
  const w = tasksLib.waves(list.tasks);
  if (flags.json) ctx.stdout.write(JSON.stringify(w) + '\n');
  else ctx.stdout.write(w.map((ids, i) => `wave ${i + 1}: ${ids.join(', ')}`).join('\n') + (w.length ? '\n' : ''));
  return 0;
}

function csv(v) {
  return v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : [];
}

// ---- worktree helpers ----
function requireWorktree(root, cwd, what) {
  const wt = worktreeRoot(cwd);
  if (!wt || rel(wt, root) === '') fail(`${what} must run inside a builder worktree`);
  return wt;
}
const activeFile = (wt) => path.join(wt, '.playbook', 'active-task.json');
function readActive(wt) {
  const a = readJson(activeFile(wt), null);
  if (!a) fail('no active task in this worktree; run task start <id>');
  return a;
}

function taskCmd(args, ctx) {
  const sub = args[0];
  const c = ctxFor(args.slice(1), ctx);
  const { pos, flags, root, slug } = c;
  const id = pos[0];
  const need = () => {
    if (!id) fail(`usage: task ${sub} <id>`);
    return id;
  };
  const known = (st) => {
    const list = loadList(root, slug, st.features[slug]);
    return list.tasks.find((t) => t.id === id) || null;
  };

  if (sub === 'start') {
    need();
    const wt = requireWorktree(root, ctx.cwd, 'task start');
    const t = known(c.st);
    if (!t) fail(`unknown task ${id}`);
    let branch = null;
    try {
      branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ctx.cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch { /* leave null */ }
    const { line, ...fields } = t; // eslint-disable-line no-unused-vars
    writeJsonAtomic(activeFile(wt), {
      ...fields, startedAt: new Date().toISOString(), lockedTests: [], lastEditAt: null, proofs: [],
    });
    state.update(root, (st) => {
      const tf = st.features[slug].tasks;
      tf[id] = { attempts: 0, ...(tf[id] || {}), status: 'in-progress', worktree: wt, branch };
    });
    ctx.stdout.write(`task ${id}: started in ${wt}\n`);
    return 0;
  }

  if (sub === 'set') {
    need();
    const status = pos[1];
    if (!STATUSES.includes(status)) fail(`invalid status "${status || ''}" (expected one of ${STATUSES.join(', ')})`);
    state.update(root, (st) => {
      const tf = st.features[slug].tasks;
      if (!tf[id] && !known(st)) fail(`unknown task ${id}`);
      const t = tf[id] = { attempts: 0, ...(tf[id] || {}) };
      t.status = status;
      if (status === 'failed') t.attempts = (t.attempts || 0) + 1;
      if (status === 'dispatched') t.dispatchedAt = new Date().toISOString();
      for (const k of ['branch', 'worktree', 'sha']) if (flags[k] !== undefined) t[k] = flags[k];
    });
    ctx.stdout.write(`task ${id}: ${status}\n`);
    return 0;
  }

  if (sub === 'add') {
    need();
    if (!flags.proof) fail('task add needs --proof <cmd>');
    if (!flags.owns) fail('task add needs --owns a,b');
    state.update(root, (st) => {
      const f = st.features[slug];
      if (loadList(root, slug, f).tasks.some((t) => t.id === id)) fail(`task ${id} already exists`);
      f.extraTasks.push({
        id, title: flags.title || id, covers: [], depends_on: csv(flags.depends),
        owns: csv(flags.owns), shared: [], proof: flags.proof, kind: 'task',
      });
      if (!f.tasks[id]) f.tasks[id] = { status: 'todo', attempts: 0 };
    });
    ctx.stdout.write(`task ${id}: added\n`);
    return 0;
  }

  if (sub === 'lock-tests') {
    const wt = requireWorktree(root, ctx.cwd, 'task lock-tests');
    if (!pos.length) fail('usage: task lock-tests <path...>');
    const a = readActive(wt);
    for (const p of pos) {
      const r = rel(path.resolve(ctx.cwd, p), wt);
      if (r === null || r === '') fail(`${p} is outside the worktree`);
      if (!a.lockedTests.includes(r)) a.lockedTests.push(r);
    }
    writeJsonAtomic(activeFile(wt), a);
    ctx.stdout.write(`locked ${a.lockedTests.length} test path(s)\n`);
    return 0;
  }

  if (sub === 'check') {
    need();
    const t = c.f.tasks[id];
    if (!t || !t.worktree) {
      ctx.stderr.write(`task ${id}: no worktree recorded; no proof run\n`);
      return 1;
    }
    const a = readJson(activeFile(t.worktree), null);
    if (!a || a.id !== id) {
      ctx.stderr.write(`task ${id}: no active task in ${t.worktree}; no proof run\n`);
      return 1;
    }
    const chk = tasksLib.checkProof(a);
    if (!chk.ok) {
      ctx.stderr.write(`task ${id}: ${chk.reason}
`);
      return 1;
    }
    ctx.stdout.write(`task ${id}: proof passed\n`);
    return 0;
  }

  fail('usage: task start|set|add|lock-tests|check ...');
  return 1;
}

function proofCmd(args, ctx) {
  const { root, slug } = ctxFor(args, ctx);
  const wt = requireWorktree(root, ctx.cwd, 'proof');
  const a = readActive(wt);
  if (!a.proof) fail(`task ${a.id} has no proof command`);
  const startedAt = new Date().toISOString();
  const r = spawnSync(a.proof, { shell: true, cwd: wt, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.stdout) ctx.stdout.write(r.stdout);
  if (r.stderr) ctx.stderr.write(r.stderr);
  if (r.error) {
    ctx.stderr.write(`playbook: could not run proof: ${r.error.message}\n`);
    return 1;
  }
  const exit = typeof r.status === 'number' ? r.status : 1;
  const entry = { at: startedAt, exit };
  withLock(activeFile(wt), () => {
    const fresh = readActive(wt); // re-read: hooks may have updated lastEditAt while the proof ran
    fresh.proofs = (fresh.proofs || []).concat(entry);
    writeJsonAtomic(activeFile(wt), fresh);
  });
  state.update(root, (st) => {
    const tf = st.features[slug].tasks;
    const t = tf[a.id] = { status: 'in-progress', attempts: 0, ...(tf[a.id] || {}) };
    t.proofs = (t.proofs || []).concat(entry).slice(-10);
  });
  return exit;
}

function progressCmd(args, ctx) {
  const { root, slug, f } = ctxFor(args, ctx);
  const list = loadList(root, slug, f);
  const rows = ['# Progress', '', '| id | title | status | attempts | branch |', '| --- | --- | --- | --- | --- |'];
  for (const t of list.tasks) {
    const s = f.tasks[t.id] || {};
    const cell = (v) => String(v === undefined || v === null ? '' : v).replace(/\|/g, '\\|');
    rows.push(`| ${t.id} | ${cell(t.title)} | ${s.status || 'todo'} | ${s.attempts || 0} | ${cell(s.branch)} |`);
  }
  const file = docFile(root, slug, 'progress.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.join('\n') + '\n');
  ctx.stdout.write(`wrote ${rel(file, root)}\n`);
  return 0;
}

module.exports = { tasks, waves: wavesCmd, task: taskCmd, proof: proofCmd, progress: progressCmd };
