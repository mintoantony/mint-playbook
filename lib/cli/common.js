'use strict';
const path = require('node:path');
const { mainRoot } = require('../paths');
const state = require('../state');

class CliError extends Error {}

function fail(msg) {
  throw new CliError(msg);
}

const VALUE_FLAGS = ['base', 'title', 'feature', 'branch', 'worktree', 'sha', 'owns', 'proof', 'depends', 'limit'];
const BOOL_FLAGS = ['json', 'next', 'none'];

// Splits argv into positional args and flags (value flags take the next argument).
function parseArgs(args) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const name = a.startsWith('--') ? a.slice(2) : null;
    if (name && BOOL_FLAGS.includes(name)) flags[name] = true;
    else if (name && VALUE_FLAGS.includes(name)) {
      if (i + 1 >= args.length) fail(a + ' needs a value');
      flags[name] = args[++i];
    } else pos.push(a);
  }
  return { pos, flags };
}

function validSlug(slug) {
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    fail(`invalid feature slug "${slug || ''}" (use lowercase letters, digits and dashes)`);
  }
  return slug;
}

function requireRoot(cwd) {
  const root = mainRoot(cwd);
  if (!root) fail('not a git repository; run git init first');
  return root;
}

function requireState(root) {
  const st = state.load(root);
  if (!st) fail('not initialised; run playbook init <slug> --title <title>');
  return st;
}

function resolveSlug(st, flags) {
  const slug = flags.feature || st.activeFeature;
  if (!slug) fail('no active feature; run feature use <slug> (or feature new <slug>)');
  if (!st.features[slug]) fail(`unknown feature ${slug}`);
  return slug;
}

function docPath(root, slug, gate) {
  return path.join(require('../paths').featureDir(root, slug), state.gateDoc(gate));
}

module.exports = { CliError, fail, parseArgs, validSlug, requireRoot, requireState, resolveSlug, docPath };
