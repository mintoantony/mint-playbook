'use strict';
// Pure task logic: parsing tasks.md, validation, waves. No fs, no git.
const yaml = require('./yaml-lite');
const { match } = require('./glob');

const LIST_FIELDS = ['covers', 'depends_on', 'owns', 'shared'];

function listOf(v) {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.map(String);
  return null;
}

// Returns {tasks, errors}. Error lines are 1-based lines in the md file.
function parse(md) {
  const lines = String(md).split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*```ya?ml\s*$/.test(l));
  if (start < 0) return { tasks: [], errors: [{ line: 1, msg: 'no yaml task block found' }] };
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*```\s*$/.test(lines[i])) { end = i; break; }
  }
  if (end < 0) return { tasks: [], errors: [{ line: start + 1, msg: 'unterminated yaml block' }] };
  const body = lines.slice(start + 1, end);
  const offset = start + 1; // yaml line n is file line offset + n

  let items;
  try {
    items = yaml.parse(body.join('\n'));
  } catch (e) {
    if (e && e.name === 'YamlError') {
      return { tasks: [], errors: [{ line: offset + e.line, msg: e.message.replace(/^line \d+: /, '') }] };
    }
    throw e;
  }
  // Start line of each top-level list entry, in order.
  const starts = [];
  body.forEach((l, i) => { if (/^-(\s|$)/.test(l)) starts.push(offset + i + 1); });

  const tasks = [];
  const errors = [];
  items.forEach((it, idx) => {
    const line = starts[idx] || offset + 1;
    if (!it || typeof it !== 'object' || Array.isArray(it)) {
      errors.push({ line, msg: 'task entry must be a map with id, title, covers, depends_on, owns, proof' });
      return;
    }
    if (it.id === undefined || it.id === null || String(it.id).trim() === '') {
      errors.push({ line, msg: 'task entry is missing "id"' });
      return;
    }
    const t = {
      id: String(it.id).trim(),
      title: it.title === undefined || it.title === null ? '' : String(it.title),
      covers: [], depends_on: [], owns: [], shared: [],
      proof: it.proof === undefined || it.proof === null || it.proof === '' ? null : String(it.proof),
      kind: it.kind ? String(it.kind) : 'task',
      line,
    };
    for (const f of LIST_FIELDS) {
      const l = listOf(it[f]);
      if (l === null) {
        if (typeof it[f] === 'string') t[f] = [it[f]];
        else errors.push({ line, msg: `task ${t.id}: "${f}" must be a list` });
      } else t[f] = l;
    }
    tasks.push(t);
  });
  return { tasks, errors };
}

function requirementIds(specMd) {
  const out = [];
  const re = /^\s*[-*#]*\s*\**(R\d+)\b/;
  for (const l of String(specMd).split(/\r?\n/)) {
    const m = re.exec(l);
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

function globsOverlap(a, b) {
  return a === b || match(a, b) || match(b, a);
}

function ancestors(id, byId, memo = new Map()) {
  if (memo.has(id)) return memo.get(id);
  const out = new Set();
  memo.set(id, out); // guards against cycles
  const t = byId.get(id);
  if (t) {
    for (const d of t.depends_on) {
      if (!byId.has(d)) continue;
      out.add(d);
      for (const x of ancestors(d, byId, memo)) out.add(x);
    }
  }
  return out;
}

function findCycle(tasks, byId) {
  const state = new Map(); // 1 visiting, 2 done
  const stack = [];
  let found = null;
  const visit = (id) => {
    if (found) return;
    state.set(id, 1);
    stack.push(id);
    for (const d of byId.get(id).depends_on) {
      if (!byId.has(d) || found) continue;
      if (state.get(d) === 1) {
        found = stack.slice(stack.indexOf(d)).concat(d);
        return;
      }
      if (!state.has(d)) visit(d);
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const t of tasks) if (!state.has(t.id) && !found) visit(t.id);
  return found;
}

function validate(tasks, requirementIdList) {
  const errors = [];
  const byId = new Map();
  for (const t of tasks) {
    if (byId.has(t.id)) errors.push({ line: t.line, msg: `duplicate task id ${t.id}` });
    else byId.set(t.id, t);
  }
  if (!byId.has('T0')) errors.push({ msg: 'task T0 (the bootstrap task) is required' });

  const covered = new Set();
  for (const t of tasks) {
    for (const c of t.covers || []) covered.add(c);
    if (!t.proof) errors.push({ line: t.line, msg: `task ${t.id} has no proof command` });
    if (t.kind !== 'bootstrap' && !(t.owns || []).some((g) => /test|spec/.test(g))) {
      errors.push({ line: t.line, msg: `task ${t.id} must own at least one test or spec glob (path containing "test" or "spec")` });
    }
    for (const d of t.depends_on || []) {
      if (!byId.has(d)) errors.push({ line: t.line, msg: `task ${t.id} depends on unknown task ${d}` });
    }
  }
  for (const r of requirementIdList || []) {
    if (!covered.has(r)) errors.push({ msg: `requirement ${r} is not covered by any task` });
  }

  const cycle = findCycle(tasks.filter((t) => byId.get(t.id) === t), byId);
  if (cycle) errors.push({ line: byId.get(cycle[0]).line, msg: `dependency cycle: ${cycle.join(' -> ')}` });

  const memo = new Map();
  const uniq = [...byId.values()];
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      const a = uniq[i];
      const b = uniq[j];
      if (ancestors(a.id, byId, memo).has(b.id) || ancestors(b.id, byId, memo).has(a.id)) continue;
      let hit = null;
      for (const ga of a.owns || []) {
        for (const gb of b.owns || []) {
          if (!hit && globsOverlap(ga, gb)) hit = [ga, gb];
        }
      }
      if (hit) {
        errors.push({
          line: b.line,
          msg: `tasks ${a.id} and ${b.id} own overlapping paths (${hit[0]} vs ${hit[1]}) but neither depends on the other`,
        });
      }
    }
  }
  return errors;
}

function statusOf(statusById, id) {
  const v = statusById && statusById[id];
  if (!v) return { status: 'todo', attempts: 0 };
  if (typeof v === 'string') return { status: v, attempts: 0 };
  return { status: v.status || 'todo', attempts: v.attempts || 0 };
}

// Level-by-level topological layers. Tasks on a cycle or with unknown deps are left out.
function waves(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const level = new Map();
  const visiting = new Set();
  const lvl = (id) => {
    if (level.has(id)) return level.get(id);
    if (visiting.has(id)) return -1;
    visiting.add(id);
    let n = 0;
    for (const d of byId.get(id).depends_on) {
      if (!byId.has(d)) { n = -1; break; }
      const l = lvl(d);
      if (l < 0) { n = -1; break; }
      n = Math.max(n, l + 1);
    }
    visiting.delete(id);
    level.set(id, n);
    return n;
  };
  const out = [];
  for (const t of tasks) {
    const l = lvl(t.id);
    if (l < 0) continue;
    (out[l] = out[l] || []).push(t.id);
  }
  return out.filter(Boolean);
}

function nextWave(tasks, statusById, limit) {
  const out = [];
  for (const t of tasks) {
    const s = statusOf(statusById, t.id);
    const runnable = s.status === 'todo' || (s.status === 'failed' && s.attempts < 2);
    if (!runnable) continue;
    if (!t.depends_on.every((d) => statusOf(statusById, d).status === 'done')) continue;
    out.push(t.id);
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = { parse, validate, requirementIds, waves, nextWave };
