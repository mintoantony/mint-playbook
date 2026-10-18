'use strict';
const path = require('node:path');
const { mainRoot } = require('../paths');
const state = require('../state');

class CliError extends Error {}

function fail(msg) {
  throw new CliError(msg);
}

// Splits argv into positional args and flags. Flags: --json (boolean), --title/--feature (value).
function parseArgs(args) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') flags.json = true;
    else if (a === '--title' || a === '--feature') {
      if (i + 1 >= args.length) fail(`${a} needs a value`);
      flags[a.slice(2)] = args[++i];
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
  if (!slug || !st.features[slug]) fail(`unknown feature ${slug}`);
  return slug;
}

function docPath(root, slug, gate) {
  return path.join(require('../paths').featureDir(root, slug), state.gateDoc(gate));
}

module.exports = { CliError, fail, parseArgs, validSlug, requireRoot, requireState, resolveSlug, docPath };
