#!/usr/bin/env node
'use strict';

// Control-band detector (Western Electric rules). No dependencies; Node >= 18.
//
//   node detect-bands.js bands.yaml metrics.json [--fail-on-findings]
//
// metrics.json: { "<metric>": [ { "t": "<ISO time or epoch ms>", "v": <number> }, ... ] }
// For each metric named in bands.yaml the last `recent_points` points are the recent window
// and the baseline is the points in the `baseline_days` days before that window.
// Prints { "findings": [...] } as JSON. Exit 0, or 1 with --fail-on-findings when there are
// findings, or 2 on bad input.

const fs = require('node:fs');

const DAY_MS = 86400000;

// ---- statistics and rules ----

function stats(values) {
  if (!values.length) return { mean: 0, sd: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
  return { mean, sd: Math.sqrt(variance) };
}

// Slide a window of up to `size` points over `zs`; true when `need` of them are beyond `limit`
// sigma on the same side. A series shorter than the window is checked as one window.
function kOfN(zs, need, size, limit) {
  const n = Math.min(size, zs.length);
  for (let i = 0; i + n <= zs.length; i++) {
    const w = zs.slice(i, i + n);
    if (w.filter((z) => z > limit).length >= need) return true;
    if (w.filter((z) => z < -limit).length >= need) return true;
  }
  return false;
}

function sameSideRun(zs, length) {
  let run = 0;
  let side = 0;
  for (const z of zs) {
    const s = Math.sign(z);
    run = s !== 0 && s === side ? run + 1 : s !== 0 ? 1 : 0;
    side = s;
    if (run >= length) return true;
  }
  return false;
}

// history: baseline numbers. recent: the newest numbers, oldest first.
// Returns the highest tier that fires, or { tier: null, rule: null }.
function evaluate(history, recent) {
  const none = { tier: null, rule: null };
  const { mean, sd } = stats(history);
  if (!history.length || !recent.length || !(sd > 1e-9 * Math.max(1, Math.abs(mean)))) return none; // flat (float noise counts as flat) or empty: no band
  const zs = recent.map((v) => (v - mean) / sd);

  if (zs.some((z) => Math.abs(z) > 3)) return { tier: '3sigma', rule: '1 point beyond 3 sigma' };
  if (kOfN(zs, 2, 3, 2)) return { tier: '2sigma', rule: '2 of 3 points beyond 2 sigma on the same side' };
  if (kOfN(zs, 4, 5, 1)) return { tier: '1sigma', rule: '4 of 5 points beyond 1 sigma on the same side' };
  if (sameSideRun(zs, 8)) return { tier: '1sigma', rule: '8 consecutive points on the same side of the mean' };
  return none;
}

// ---- bands.yaml: the shipped shape only (nested maps of scalars), or JSON ----

function scalar(raw) {
  let s = raw.trim();
  if (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s.at(-1) === s[0]) return s.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s === 'true') return true;
  if (s === 'false') return false;
  return s;
}

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) { if (c === quote) quote = null; } else if (c === '"' || c === "'") quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

function parseBands(text) {
  const t = text.replace(/^﻿/, '');
  if (t.trim().startsWith('{')) return JSON.parse(t);
  const root = {};
  const stack = [{ indent: -1, obj: root }];
  for (const [i, rawLine] of t.split(/\r?\n/).entries()) {
    const line = stripComment(rawLine).replace(/\s+$/, '');
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const m = /^([^:]+?):(?:\s+(.*))?$/.exec(line.trim());
    if (!m) throw new Error(`bands.yaml:${i + 1}: expected "key: value"`);
    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
    const parent = stack.at(-1).obj;
    const key = scalar(m[1]);
    if (m[2] === undefined || m[2] === '') {
      parent[key] = {};
      stack.push({ indent, obj: parent[key] });
    } else {
      parent[key] = scalar(m[2]);
    }
  }
  return root;
}

// ---- findings ----

function time(p) {
  return typeof p.t === 'number' ? p.t : Date.parse(p.t);
}

function findings(bands, metrics) {
  const out = [];
  const recentN = Number(bands.recent_points) || 8;
  const baseMs = (Number(bands.baseline_days) || 30) * DAY_MS;
  for (const name of Object.keys(bands.metrics || {})) {
    const points = (metrics[name] || []).filter((p) => Number.isFinite(p.v) && Number.isFinite(time(p)))
      .sort((a, b) => time(a) - time(b));
    if (points.length <= recentN) continue;
    const recent = points.slice(-recentN);
    const cut = time(recent[0]);
    const baseline = points.slice(0, -recentN).filter((p) => time(p) >= cut - baseMs);
    const hit = evaluate(baseline.map((p) => p.v), recent.map((p) => p.v));
    if (!hit.tier) continue;
    const { mean, sd } = stats(baseline.map((p) => p.v));
    const tier = (bands.tiers || {})[hit.tier] || {};
    out.push({
      metric: name,
      tier: hit.tier,
      rule: hit.rule,
      action: tier.action || null,
      mean,
      sd,
      latest: recent.at(-1).v,
      at: recent.at(-1).t,
    });
  }
  return out;
}

function main(argv) {
  const args = argv.filter((a) => !a.startsWith('--'));
  const fail = argv.includes('--fail-on-findings');
  if (args.length !== 2) {
    process.stderr.write('usage: node detect-bands.js bands.yaml metrics.json [--fail-on-findings]\n');
    return 2;
  }
  let bands;
  let metrics;
  try {
    bands = parseBands(fs.readFileSync(args[0], 'utf8'));
    metrics = JSON.parse(fs.readFileSync(args[1], 'utf8'));
  } catch (e) {
    process.stderr.write(`detect-bands: ${e.message}\n`);
    return 2;
  }
  const result = findings(bands, metrics);
  process.stdout.write(`${JSON.stringify({ findings: result }, null, 2)}\n`);
  return fail && result.length ? 1 : 0;
}

module.exports = { stats, evaluate, parseBands, findings };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
