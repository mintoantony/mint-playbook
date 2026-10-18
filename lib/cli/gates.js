'use strict';
const fs = require('node:fs');
const path = require('node:path');
const state = require('../state');
const { rel, stateDir } = require('../paths');
const { writeJsonAtomic } = require('../store');
const { fail, parseArgs, requireRoot, requireState, resolveSlug, docPath } = require('./common');

function gateArg(pos) {
  const gate = pos[0];
  if (!gate) fail(`gate name required (${state.GATES.join(', ')})`);
  state.gateDoc(gate); // validates
  return gate;
}

// Hash of the gate's document; errors when it does not exist.
function docHash(root, slug, gate) {
  const p = docPath(root, slug, gate);
  if (!fs.existsSync(p)) fail(`${state.gateDoc(gate)} not found at ${rel(p, root)}`);
  return state.hashFile(p);
}

function request(args, ctx) {
  const { pos, flags } = parseArgs(args);
  const root = requireRoot(ctx.cwd);
  const gate = gateArg(pos);
  requireState(root);
  state.update(root, (st) => {
    const slug = resolveSlug(st, flags);
    state.request(st, slug, gate, () => docHash(root, slug, gate));
    ctx.stdout.write(`${slug}: ${gate} awaiting approval\n`);
  });
}

function approve(args, ctx) {
  const { pos, flags } = parseArgs(args);
  const root = requireRoot(ctx.cwd);
  const gate = gateArg(pos);
  requireState(root);
  state.update(root, (st) => {
    const slug = resolveSlug(st, flags);
    const g = st.features[slug].gates[gate];
    if (g.status !== 'awaiting-approval') {
      fail(`gate ${gate} is not awaiting approval (status: ${g.status})`);
    }
    const entry = state.approve(st, slug, gate, docHash(root, slug, gate));
    writeJsonAtomic(path.join(stateDir(root), 'approvals', `${slug}-${gate}.json`), { feature: slug, ...entry });
    ctx.stdout.write(`${slug}: ${gate} approved\n`);
  });
}

function reject(args, ctx) {
  const { pos, flags } = parseArgs(args);
  const root = requireRoot(ctx.cwd);
  const gate = gateArg(pos);
  requireState(root);
  state.update(root, (st) => {
    const slug = resolveSlug(st, flags);
    state.reject(st, slug, gate, pos.slice(1).join(' '));
    ctx.stdout.write(`${slug}: ${gate} rejected\n`);
  });
}

function reopen(args, ctx) {
  const { pos, flags } = parseArgs(args);
  const root = requireRoot(ctx.cwd);
  const gate = gateArg(pos);
  requireState(root);
  state.update(root, (st) => {
    const slug = resolveSlug(st, flags);
    state.reopen(st, slug, gate);
    ctx.stdout.write(`${slug}: ${gate} reopened; later gates marked stale where needed\n`);
  });
}

module.exports = { request, approve, reject, reopen };
