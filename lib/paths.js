'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const win = () => process.platform === 'win32';

function git(cwd, args) {
  try {
    const out = execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

function mainRoot(cwd) {
  const common = git(cwd, ['rev-parse', '--git-common-dir']);
  if (!common) return null;
  const abs = path.resolve(cwd, common);
  // Normal repo: <root>/.git. Bare/odd layouts: fall back to the dir itself.
  return path.basename(abs) === '.git' ? path.dirname(abs) : abs;
}

function worktreeRoot(cwd) {
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  return top ? path.resolve(cwd, top) : null;
}

const kindOf = (p) => {
  try {
    const s = fs.statSync(p);
    return s.isDirectory() ? 'dir' : 'file';
  } catch {
    return null;
  }
};

// The `.git` file of a linked worktree reads `gitdir: <main>/.git/worktrees/<name>`.
function linkedTo(wt, main) {
  let text;
  try { text = fs.readFileSync(path.join(wt, '.git'), 'utf8'); } catch { return false; }
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(text);
  if (!m) return false;
  const r = rel(path.resolve(wt, m[1]), path.join(main, '.git', 'worktrees'));
  return typeof r === 'string' && r !== '' && !r.includes('/');
}

// Hook fast path: {mainRoot, wtRoot} for cwd, or null outside a repository. Walks up
// without spawning git: the nearest `.git` directory is the main root (a plain checkout,
// or a worktree nested inside it, e.g. <main>/.claude/worktrees/agent-x). Only a linked
// worktree that is not nested in its main checkout falls back to git rev-parse.
function locate(cwd) {
  let wt = null;
  let d = path.resolve(cwd);
  for (;;) {
    const k = kindOf(path.join(d, '.git'));
    if (k === 'dir') {
      if (!wt) return { mainRoot: d, wtRoot: d };
      if (linkedTo(wt, d)) return { mainRoot: d, wtRoot: wt };
      break;
    }
    if (k === 'file' && !wt) wt = d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  if (!wt) return null;
  const main = mainRoot(cwd);
  return main ? { mainRoot: main, wtRoot: worktreeRoot(cwd) || main } : null;
}

// Windows: expand 8.3 short names (C:\Users\RUNNER~1) so a short cwd and git's long
// paths compare equal. The longest existing ancestor is resolved; the rest is kept.
function longPath(p) {
  let head = p;
  const tail = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(head), ...tail);
    } catch {
      const up = path.dirname(head);
      if (up === head) return p;
      tail.unshift(path.basename(head));
      head = up;
    }
  }
}

function norm(p) {
  let s = path.resolve(p);
  if (win() && s.includes('~')) s = longPath(s);
  s = s.replace(/\\/g, '/');
  if (s.length > 1) s = s.replace(/\/+$/, '');
  return s;
}

function rel(absPath, root) {
  const a = norm(absPath);
  const r = norm(root);
  const ci = win();
  const al = ci ? a.toLowerCase() : a;
  const rl = ci ? r.toLowerCase() : r;
  if (al === rl) return '';
  const prefix = rl.endsWith('/') ? rl : rl + '/';
  if (!al.startsWith(prefix)) return null;
  return a.slice(prefix.length);
}

function stateDir(root) {
  return path.join(root, '.playbook');
}

function featureDir(root, slug) {
  return path.join(root, 'docs', 'playbook', slug);
}

module.exports = { mainRoot, worktreeRoot, locate, rel, stateDir, featureDir };
