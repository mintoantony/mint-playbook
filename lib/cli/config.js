'use strict';
const path = require('node:path');
const { stateDir } = require('../paths');
const { readJson, writeJsonAtomic, withLock } = require('../store');
const { fail, requireRoot } = require('./common');

const STRING_KEYS = ['setup', 'test', 'lint', 'format'];
const KEYS = ['concurrency', ...STRING_KEYS, 'testReport', 'protected'];

function parseValue(key, raw) {
  if (key === 'concurrency') {
    if (!/^\d+$/.test(raw) || Number(raw) < 1) fail(`concurrency must be an integer >= 1 (got "${raw}")`);
    return Number(raw);
  }
  if (key === 'protected') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (key === 'testReport' && raw === 'null') return null;
  return raw;
}

function config(args, ctx) {
  const sub = args[0];
  const root = requireRoot(ctx.cwd);
  const file = path.join(stateDir(root), 'config.json');
  if (sub === 'set') {
    const [key, value] = [args[1], args[2]];
    if (!key || value === undefined) fail('usage: config set <key> <value>');
    if (!KEYS.includes(key)) fail(`unknown config key ${key} (allowed: ${KEYS.join(', ')})`);
    const parsed = parseValue(key, value);
    withLock(file, () => {
      const cfg = readJson(file, {}) || {};
      cfg[key] = parsed;
      writeJsonAtomic(file, cfg);
    });
    ctx.stdout.write(`config ${key} = ${JSON.stringify(parsed)}\n`);
    return 0;
  }
  if (sub === 'get') {
    const cfg = readJson(file, {}) || {};
    const key = args[1];
    if (!key) {
      ctx.stdout.write(JSON.stringify(cfg, null, 2) + '\n');
      return 0;
    }
    if (!KEYS.includes(key)) fail(`unknown config key ${key} (allowed: ${KEYS.join(', ')})`);
    const v = cfg[key];
    ctx.stdout.write((typeof v === 'string' ? v : JSON.stringify(v === undefined ? null : v)) + '\n');
    return 0;
  }
  fail('usage: config set <key> <value> | config get [<key>]');
  return 1;
}

module.exports = { config };
