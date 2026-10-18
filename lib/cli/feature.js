'use strict';
const fs = require('node:fs');
const path = require('node:path');
const state = require('../state');
const { rel, stateDir, featureDir } = require('../paths');
const { writeJsonAtomic } = require('../store');
const { fail, parseArgs, validSlug, requireRoot, requireState, resolveSlug } = require('./common');

const DEFAULT_CONFIG = {
  concurrency: 3, setup: null, test: null, lint: null, format: null, testReport: null, protected: [],
};

function ensureGitignore(root) {
  const file = path.join(root, '.gitignore');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (text.split(/\r?\n/).some((l) => l.trim() === '.playbook/')) return;
  const sep = text && !text.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(file, `${text}${sep}.playbook/\n`);
}

function init(args, ctx) {
  const { pos, flags } = parseArgs(args);
  const root = requireRoot(ctx.cwd);
  const slug = validSlug(pos[0]);
  if (fs.existsSync(state.stateFile(root))) fail('already initialised; use feature new');
  const st = {
    version: 1,
    activeFeature: slug,
    features: { [slug]: state.newFeature(slug, flags.title) },
  };
  writeJsonAtomic(state.stateFile(root), st);
  const cfg = path.join(stateDir(root), 'config.json');
  if (!fs.existsSync(cfg)) writeJsonAtomic(cfg, DEFAULT_CONFIG);
  ensureGitignore(root);
  ctx.stdout.write(`initialised playbook; active feature ${slug}\n`);
}

function status(args, ctx) {
  const { flags } = parseArgs(args);
  const root = requireRoot(ctx.cwd);
  const st = requireState(root);
  const slug = resolveSlug(st, flags);
  const f = st.features[slug];
  if (flags.json) {
    ctx.stdout.write(JSON.stringify(f, null, 2) + '\n');
    return;
  }
  const counts = {};
  for (const t of Object.values(f.tasks)) counts[t.status] = (counts[t.status] || 0) + 1;
  const total = Object.keys(f.tasks).length;
  const detail = Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ');
  const lines = [`feature: ${slug} (${f.title})`, `branch: ${f.branch}`, 'gates:'];
  for (const g of state.GATES) lines.push(`  ${g.padEnd(8)}${f.gates[g].status}`);
  lines.push(`tasks: ${total}${detail ? ` (${detail})` : ''}`);
  ctx.stdout.write(lines.join('\n') + '\n');
}

function next(args, ctx) {
  const { flags } = parseArgs(args);
  const root = requireRoot(ctx.cwd);
  const st = requireState(root);
  const slug = resolveSlug(st, flags);
  const step = state.currentStep(st, slug, root);
  const doc = step.gate ? rel(path.join(featureDir(root, slug), state.gateDoc(step.gate)), root) : null;
  const out = { feature: slug, stage: step.stage, gate: step.gate, action: step.action, doc };
  if (step.reason) out.reason = step.reason;
  if (flags.json) {
    ctx.stdout.write(JSON.stringify(out) + '\n');
    return;
  }
  let line = `${slug}: ${step.action}`;
  if (step.gate) line += ` (gate ${step.gate}, stage ${step.stage}, doc ${doc})`;
  if (step.reason) line += `\nreason: ${step.reason}`;
  ctx.stdout.write(line + '\n');
}

function featureCmd(args, ctx) {
  const sub = args[0];
  const { pos, flags } = parseArgs(args.slice(1));
  const root = requireRoot(ctx.cwd);
  requireState(root);
  if (sub === 'new') {
    const slug = validSlug(pos[0]);
    state.update(root, (st) => {
      if (st.features[slug]) fail(`feature ${slug} already exists`);
      st.features[slug] = state.newFeature(slug, flags.title);
      st.activeFeature = slug;
    });
    ctx.stdout.write(`feature ${slug} created and active\n`);
  } else if (sub === 'use' && flags.none) {
    // No active feature: the gate rules stop applying (post-done policy).
    state.update(root, (st) => { st.activeFeature = null; });
    ctx.stdout.write('no active feature; gate rules are off until feature use <slug> or feature new\n');
  } else if (sub === 'use') {
    const slug = pos[0];
    state.update(root, (st) => {
      if (!slug || !st.features[slug]) fail(`unknown feature ${slug}`);
      st.activeFeature = slug;
    });
    ctx.stdout.write(`active feature ${slug}\n`);
  } else {
    fail('usage: feature new <slug> --title <t> | feature use <slug> | feature use --none');
  }
}

module.exports = { init, status, next, feature: featureCmd };
