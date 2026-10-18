'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const T = path.join(__dirname, '..', 'skills', 'close-the-loop', 'templates');
const DETECT = path.join(T, 'detect-bands.js');
const { stats, evaluate, parseBands, findings } = require(DETECT);

// Baseline with mean 0.2 and sd 0.3 (population): half the points at 0.5, half at -0.1.
const BASE = Array.from({ length: 30 }, (_, i) => (i % 2 ? -0.1 : 0.5));

test('stats returns mean and population sd', () => {
  const s = stats(BASE);
  assert.ok(Math.abs(s.mean - 0.2) < 1e-9);
  assert.ok(Math.abs(s.sd - 0.3) < 1e-9);
  assert.deepEqual(stats([]), { mean: 0, sd: 0 });
});

test('spec worked example: mean 0.2%, reading 1.9%, sd 0.3% -> 3sigma', () => {
  assert.equal(evaluate(BASE, [1.9]).tier, '3sigma');
});

test('calm readings give null', () => {
  assert.deepEqual(evaluate(BASE, [0.2, 0.3, 0.1]), { tier: null, rule: null });
});

test('flat series gives null, never a divide-by-zero tier', () => {
  const flat = Array(30).fill(0.2);
  assert.deepEqual(evaluate(flat, [0.2, 0.2]), { tier: null, rule: null });
  assert.deepEqual(evaluate(flat, [99]), { tier: null, rule: null });
  assert.deepEqual(evaluate([], [1]), { tier: null, rule: null });
  assert.deepEqual(evaluate(BASE, []), { tier: null, rule: null });
});

test('2 of 3 beyond 2 sigma on the same side -> 2sigma', () => {
  // 2 sigma band is 0.2 +/- 0.6; 1.0 is beyond (2.67 sigma) but not 3 sigma (1.1)
  assert.equal(evaluate(BASE, [1.0, 0.2, 1.0]).tier, '2sigma');
  assert.equal(evaluate(BASE, [1.0, 1.0]).tier, '2sigma');
});

test('2 beyond 2 sigma on opposite sides is not 2sigma', () => {
  assert.equal(evaluate(BASE, [1.0, -0.5, 0.2]).tier, null);
});

test('2 beyond 2 sigma but more than 3 apart is not 2sigma', () => {
  assert.equal(evaluate(BASE, [1.0, 0.2, 0.2, 1.0]).tier, null);
});

test('4 of 5 beyond 1 sigma on the same side -> 1sigma', () => {
  // 1 sigma band is 0.2 +/- 0.3 ; 0.6 is beyond
  const r = evaluate(BASE, [0.6, 0.6, 0.2, 0.6, 0.6]);
  assert.equal(r.tier, '1sigma');
  assert.match(r.rule, /4 of 5/);
});

test('3 of 5 beyond 1 sigma is not enough', () => {
  assert.equal(evaluate(BASE, [0.6, 0.6, 0.2, 0.6, 0.2]).tier, null);
});

test('8 consecutive same side of the mean -> 1sigma', () => {
  const r = evaluate(BASE, Array(8).fill(0.25));
  assert.equal(r.tier, '1sigma');
  assert.match(r.rule, /8 consecutive/);
  assert.equal(evaluate(BASE, Array(7).fill(0.25)).tier, null);
  assert.equal(evaluate(BASE, [0.25, 0.25, 0.25, 0.25, 0.1, 0.25, 0.25, 0.25]).tier, null);
});

test('the highest tier wins', () => {
  assert.equal(evaluate(BASE, [0.6, 0.6, 1.0, 1.0, 1.9]).tier, '3sigma');
  assert.equal(evaluate(BASE, [0.6, 0.6, 0.2, 1.0, 1.0]).tier, '2sigma');
});

test('a low-side 3 sigma point also fires', () => {
  assert.equal(evaluate(BASE, [-1.0]).tier, '3sigma');
});

test('parseBands reads the shipped bands.yaml shape', () => {
  const b = parseBands(fs.readFileSync(path.join(T, 'bands.yaml'), 'utf8'));
  assert.equal(b.baseline_days, 30);
  assert.ok(b.recent_points >= 8);
  assert.ok(Object.keys(b.metrics).length >= 1);
  const first = Object.values(b.metrics)[0];
  assert.equal(first.baseline, 'rolling_30d');
  assert.equal(first.rules, 'western_electric');
  assert.equal(b.tiers['1sigma'].action, 'log');
  assert.match(b.tiers['2sigma'].action, /diagnose/);
  assert.match(b.tiers['3sigma'].action, /propose/);
});

test('parseBands also accepts JSON', () => {
  const b = parseBands('{"metrics":{"m":{}},"tiers":{"1sigma":{"action":"log"}}}');
  assert.equal(b.tiers['1sigma'].action, 'log');
});

function series(values, startMs, stepMs = 3600 * 1000) {
  return values.map((v, i) => ({ t: new Date(startMs + i * stepMs).toISOString(), v }));
}

test('findings uses the recent window, the baseline before it, and the tier action', () => {
  const bands = { baseline_days: 30, recent_points: 3, metrics: { err: {}, calm: {} },
    tiers: { '3sigma': { action: 'propose it' } } };
  const start = Date.UTC(2026, 0, 1);
  const metrics = {
    err: series([...BASE, 0.2, 0.2, 1.9], start),
    calm: series([...BASE, 0.2, 0.3, 0.1], start),
    unknown: series([1, 2, 3], start),
  };
  const out = findings(bands, metrics);
  assert.equal(out.length, 1);
  assert.equal(out[0].metric, 'err');
  assert.equal(out[0].tier, '3sigma');
  assert.equal(out[0].action, 'propose it');
  assert.equal(out[0].latest, 1.9);
});

test('findings ignores baseline points older than baseline_days', () => {
  const bands = { baseline_days: 1, recent_points: 1, metrics: { m: {} }, tiers: {} };
  const start = Date.UTC(2026, 0, 1);
  const old = series([0, 10, 0, 10], start - 10 * 86400000);
  const flat = series(Array(24).fill(1), start);
  const spike = series([5], start + 24 * 3600000);
  assert.deepEqual(findings(bands, { m: [...old, ...flat, ...spike] }), []);
});

test('CLI prints JSON findings and exits 0; --fail-on-findings exits 1; bad input exits 2', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bands-'));
  const start = Date.UTC(2026, 0, 1);
  const yamlText = fs.readFileSync(path.join(T, 'bands.yaml'), 'utf8');
  fs.writeFileSync(path.join(dir, 'bands.yaml'), yamlText);
  const name = Object.keys(parseBands(yamlText).metrics)[0];
  fs.writeFileSync(path.join(dir, 'metrics.json'), JSON.stringify({ [name]: series([...BASE, 1.9], start) }));
  const run = (...extra) => spawnSync(process.execPath,
    [DETECT, path.join(dir, 'bands.yaml'), path.join(dir, 'metrics.json'), ...extra], { encoding: 'utf8' });
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.findings.length, 1);
  assert.equal(out.findings[0].tier, '3sigma');
  assert.ok(out.findings[0].action);
  assert.equal(run('--fail-on-findings').status, 1);
  const bad = spawnSync(process.execPath,
    [DETECT, path.join(dir, 'nope.yaml'), path.join(dir, 'metrics.json')], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
});

test('detect-bands.js is standalone: guarded main, only node built-ins', () => {
  const src = fs.readFileSync(DETECT, 'utf8');
  assert.match(src, /require\.main === module/);
  for (const m of src.matchAll(/require\(['"]([^'"]+)['"]\)/g)) assert.match(m[1], /^node:/, m[1]);
});

test('maintain skill, agent, command and workflow exist and are wired', () => {
  const root = path.join(__dirname, '..');
  const skill = fs.readFileSync(path.join(root, 'skills/close-the-loop/SKILL.md'), 'utf8');
  assert.match(skill, /incident-analyst/);
  assert.match(skill, /feature new/);
  assert.match(skill, /request intent/);
  assert.match(skill, /\/mint-playbook:approve intent/);
  assert.match(skill, /evals\//);
  const cmd = fs.readFileSync(path.join(root, 'commands/maintain.md'), 'utf8');
  assert.match(cmd, /mint-playbook:close-the-loop/);
  const wf = fs.readFileSync(path.join(T, 'workflows/bands.yml'), 'utf8');
  assert.match(wf, /cron:/);
  assert.match(wf, /detect-bands\.js bands\.yaml metrics\.json/);
  assert.ok(fs.existsSync(path.join(root, 'agents/incident-analyst.md')));
});
