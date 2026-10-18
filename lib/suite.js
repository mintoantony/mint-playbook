'use strict';

const decode = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function attr(tag, name) {
  const re = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')');
  const m = re.exec(tag);
  return m ? decode(m[1] !== undefined ? m[1] : m[2]) : null;
}

function junit(xml) {
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  let m;
  let seen = false;
  const failing = [];
  while ((m = re.exec(xml))) {
    seen = true;
    if (m[2] === '/>' || !/<(failure|error)\b/.test(m[3] || '')) continue;
    const name = attr(m[1], 'name') || '';
    const cls = attr(m[1], 'classname');
    const id = cls ? `${cls}.${name}` : name;
    if (!failing.includes(id)) failing.push(id);
  }
  return seen ? { failing, count: failing.length } : null;
}

function tap(output) {
  let seen = false;
  const failing = [];
  for (const line of String(output || '').split(/\r?\n/)) {
    const m = /^(not )?ok\s+\d+\s*(?:-\s*)?(.*)$/.exec(line);
    if (!m) continue;
    seen = true;
    if (!m[1] || /#\s*(SKIP|TODO)\b/i.test(m[2])) continue;
    const id = m[2].replace(/\s+#.*$/, '').trim();
    if (id && !failing.includes(id)) failing.push(id);
  }
  if (seen) return { failing, count: failing.length };
  const s = /^#\s*fail\s+(\d+)\s*$/m.exec(String(output || ''));
  return s ? { failing: null, count: Number(s[1]) } : null;
}

function parseFailures(output, reportXml) {
  return (reportXml && junit(reportXml)) || tap(output) || { failing: null, count: null };
}

function compare(baseline, current, exitCode) {
  const none = (r) => r.failing == null && r.count == null;
  if (!none(baseline) && none(current)) {
    return { ok: false, newFailures: [], reason: `test output unparseable (exit ${exitCode})` };
  }
  const zero = (Array.isArray(current.failing) && current.failing.length === 0) || current.count === 0;
  if (exitCode !== 0 && zero) {
    return { ok: false, newFailures: [], reason: `non-zero exit (${exitCode}) with no reported failures` };
  }
  const bIds = Array.isArray(baseline.failing);
  const cIds = Array.isArray(current.failing);
  if (bIds && cIds) {
    const newFailures = current.failing.filter((id) => !baseline.failing.includes(id));
    return { ok: newFailures.length === 0, newFailures };
  }
  if (typeof baseline.count === 'number' && typeof current.count === 'number') {
    return { ok: current.count <= baseline.count, newFailures: [] };
  }
  const ok = exitCode === 0 || (baseline.exit !== 0 && exitCode === baseline.exit);
  return { ok, newFailures: [] };
}

module.exports = { parseFailures, compare };
