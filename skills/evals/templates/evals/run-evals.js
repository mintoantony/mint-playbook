#!/usr/bin/env node
'use strict';

// Runs every evals/*.json: checks out the repo at `from` in a temp git worktree,
// copies the CLAUDE.md and .claude/ under test into it, runs Claude Code headless
// (never --bare: it would skip CLAUDE.md, skills and hooks), rejects edits outside
// may_change, then runs each checks[].run shell command in the worktree.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { outsideMayChange, formatResult } = require('./check.js');

const TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS) || 15 * 60 * 1000;
const DEFAULT_TOOLS = 'Read,Edit,Bash(make test)';

function whereClaude() {
  const r = spawnSync('where', ['claude'], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
}

// Finds a spawnable claude without a shell (Node refuses to spawn .cmd shims without
// one, CVE-2024-27980, and the prompt must stay in argv). `lookup` is injectable for tests.
function resolveClaude(env = process.env, platform = process.platform, lookup = whereClaude) {
  if (env.CLAUDE_BIN) {
    return env.CLAUDE_BIN.endsWith('.js')
      ? { cmd: process.execPath, prefixArgs: [env.CLAUDE_BIN] }
      : { cmd: env.CLAUDE_BIN, prefixArgs: [] };
  }
  if (platform !== 'win32') return { cmd: 'claude', prefixArgs: [] };
  const hits = lookup();
  const exe = hits.find((h) => /\.exe$/i.test(h));
  if (exe) return { cmd: exe, prefixArgs: [] };
  for (const h of hits.filter((x) => /\.cmd$/i.test(x))) {
    const pkg = path.join(path.dirname(h), 'node_modules', '@anthropic-ai', 'claude-code');
    const nativeExe = path.join(pkg, 'bin', 'claude.exe'); // current npm package layout
    if (fs.existsSync(nativeExe)) return { cmd: nativeExe, prefixArgs: [] };
    const cli = path.join(pkg, 'cli.js'); // older layout
    if (fs.existsSync(cli)) return { cmd: process.execPath, prefixArgs: [cli] };
  }
  throw new Error('claude CLI not found; set CLAUDE_BIN');
}

function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

function runEval(evalFile, repoRoot) {
  const ev = JSON.parse(fs.readFileSync(evalFile, 'utf8'));
  const name = ev.name || path.basename(evalFile, '.json');
  const checks = Array.isArray(ev.checks) ? ev.checks : [];
  const total = checks.length;
  const notes = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-'));
  const worktree = path.join(tmp, 'wt');
  let added = false;
  let passedCount = 0;
  try {
    const add = git(['worktree', 'add', '--detach', worktree, ev.from || 'HEAD'], repoRoot);
    if (add.status !== 0) {
      notes.push(`git worktree add failed: ${(add.stderr || '').trim()}`);
      return { name, passedCount, total: total + 1, notes };
    }
    added = true;

    // Test the current CLAUDE.md and .claude/, not the ones at `from`.
    const claudeMd = path.join(repoRoot, 'CLAUDE.md');
    if (fs.existsSync(claudeMd)) fs.copyFileSync(claudeMd, path.join(worktree, 'CLAUDE.md'));
    const claudeDir = path.join(repoRoot, '.claude');
    if (fs.existsSync(claudeDir)) {
      fs.rmSync(path.join(worktree, '.claude'), { recursive: true, force: true });
      fs.cpSync(claudeDir, path.join(worktree, '.claude'), { recursive: true });
    }

    const tools = ev.allowedTools || DEFAULT_TOOLS;
    const bin = resolveClaude();
    const claude = spawnSync(bin.cmd,
      [...bin.prefixArgs, '-p', ev.prompt, '--allowedTools', tools, '--output-format', 'json'],
      { cwd: worktree, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: TIMEOUT_MS });
    if (claude.error || claude.status !== 0) {
      const timedOut = claude.error && claude.error.code === 'ETIMEDOUT';
      notes.push(timedOut ? `claude timed out after ${TIMEOUT_MS} ms`
        : `claude failed: ${claude.error ? claude.error.message : (claude.stderr || '').trim()}`);
      return { name, passedCount, total: total + 1, notes };
    }

    // Everything Claude changed or added. CLAUDE.md and .claude/ are excluded from the
    // may_change check on purpose: they are the files under test, copied in above.
    git(['add', '-A'], worktree);
    const diff = git(['diff', '--name-only', '--cached', 'HEAD'], worktree);
    const changed = (diff.stdout || '').split(/\r?\n/).filter(Boolean)
      .filter((f) => f !== 'CLAUDE.md' && !f.startsWith('.claude/'));
    const outside = outsideMayChange(changed, ev.may_change);
    const scopeOk = outside.length === 0;
    if (!scopeOk) notes.push(`changed outside may_change: ${outside.join(', ')}`);

    for (const c of checks) {
      const r = spawnSync(c.run, { shell: true, cwd: worktree, encoding: 'utf8' });
      if (r.status === 0) passedCount += 1;
      else notes.push(`check failed: ${c.run}`);
    }
    // The may_change check counts as one extra check.
    return { name, passedCount: passedCount + (scopeOk ? 1 : 0), total: total + 1, notes };
  } finally {
    if (added) git(['worktree', 'remove', '--force', worktree], repoRoot);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.json')).sort()
    .map((f) => path.join(__dirname, f));
  let failed = 0;
  for (const f of files) {
    let r;
    try {
      r = runEval(f, repoRoot);
    } catch (e) {
      r = { name: path.basename(f, '.json'), passedCount: 0, total: 1, notes: [String(e.message || e)] };
    }
    console.log(formatResult(r.name, r.passedCount, r.total));
    for (const n of r.notes) console.log(`  ${n}`);
    if (r.passedCount !== r.total) failed += 1;
  }
  console.log(`${failed} eval(s) failed`);
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();

module.exports = { runEval, main, resolveClaude };
