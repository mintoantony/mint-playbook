'use strict';
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

function norm(p) {
  let s = path.resolve(p).replace(/\\/g, '/');
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

module.exports = { mainRoot, worktreeRoot, rel, stateDir, featureDir };
