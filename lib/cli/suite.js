'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const suiteLib = require('../suite');
const state = require('../state');
const { stateDir, worktreeRoot } = require('../paths');
const { readJson } = require('../store');
const { fail, parseArgs, requireRoot, requireState, resolveSlug } = require('./common');

// Runs config.test and returns {exit, failing, count}.
function runSuite(root, cwd, ctx) {
  const cfg = readJson(path.join(stateDir(root), 'config.json'), {}) || {};
  if (!cfg.test) fail('config.test not set; set it in .playbook/config.json');
  const wt = worktreeRoot(cwd) || root;
  const r = spawnSync(cfg.test, { shell: true, cwd: wt, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.stdout) ctx.stdout.write(r.stdout);
  if (r.stderr) ctx.stderr.write(r.stderr);
  if (r.error) fail(`could not run tests: ${r.error.message}`);
  const exit = typeof r.status === 'number' ? r.status : 1;
  let xml = null;
  if (cfg.testReport) {
    const file = path.resolve(wt, cfg.testReport);
    if (fs.existsSync(file)) xml = fs.readFileSync(file, 'utf8');
  }
  return { exit, ...suiteLib.parseFailures((r.stdout || '') + '\n' + (r.stderr || ''), xml) };
}

function suite(args, ctx) {
  const sub = args[0];
  if (sub !== 'baseline' && sub !== 'check') fail('usage: suite baseline|check');
  const { flags } = parseArgs(args.slice(1));
  const root = requireRoot(ctx.cwd);
  const st = requireState(root);
  const slug = resolveSlug(st, flags);

  if (sub === 'check' && !st.features[slug].baseline) fail('no baseline; run suite baseline first');
  const cur = runSuite(root, ctx.cwd, ctx);

  if (sub === 'baseline') {
    state.update(root, (s) => {
      s.features[slug].baseline = { failing: cur.failing, count: cur.count, exit: cur.exit };
    });
    const n = cur.failing ? `${cur.failing.length} failing` : cur.count !== null ? `${cur.count} failing` : `exit ${cur.exit}`;
    ctx.stdout.write(`suite: baseline recorded (${n})\n`);
    return 0;
  }

  const res = suiteLib.compare(st.features[slug].baseline, cur, cur.exit);
  if (res.ok) {
    ctx.stdout.write('suite: ok\n');
    return 0;
  }
  ctx.stdout.write(res.newFailures.length
    ? `suite: new failures: ${res.newFailures.join(', ')}\n`
    : `suite: new failures: more failures than baseline (exit ${cur.exit})\n`);
  return 1;
}

module.exports = { suite };
