'use strict';
// Minimal YAML subset: a top-level block list of maps (or scalars), scalar values,
// quoted strings, and one-line flow arrays. Comments start with '#' at line start
// or after whitespace, outside quotes.

class YamlError extends Error {
  constructor(message, line) {
    super(`line ${line}: ${message}`);
    this.name = 'YamlError';
    this.line = line;
  }
}

function stripComment(s, line) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\' && q === '"') i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") {
      if (i === 0 || /[\s[,:]/.test(s[i - 1])) q = c;
    } else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) {
      return s.slice(0, i);
    }
  }
  return s;
}

function unquote(s, line) {
  const q = s[0];
  if (s.length < 2 || s[s.length - 1] !== q) throw new YamlError('unterminated quoted string', line);
  const body = s.slice(1, -1);
  if (q === "'") return body.replace(/''/g, "'");
  try { return JSON.parse(s); } catch { throw new YamlError('invalid double-quoted string', line); }
}

function scalar(raw, line) {
  const s = raw.trim();
  if (s === '') return null;
  if (s[0] === '"' || s[0] === "'") return unquote(s, line);
  if (s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^[-+]?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

function flowArray(s, line) {
  if (s[s.length - 1] !== ']') throw new YamlError('unterminated flow array', line);
  const inner = s.slice(1, -1);
  const out = [];
  let cur = '';
  let q = null;
  let any = false;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (q) {
      cur += c;
      if (c === '\\' && q === '"') cur += inner[++i] || '';
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") { q = c; cur += c; any = true; }
    else if (c === ',') { out.push(scalar(cur, line)); cur = ''; any = false; }
    else { cur += c; if (c.trim()) any = true; }
  }
  if (q) throw new YamlError('unterminated quoted string', line);
  if (any || out.length) out.push(scalar(cur, line));
  return out;
}

function value(raw, line) {
  const s = raw.trim();
  if (s[0] === '[') return flowArray(s, line);
  return scalar(s, line);
}

function parse(text) {
  const lines = [];
  String(text).split(/\r?\n/).forEach((l, i) => {
    const body = stripComment(l, i + 1).replace(/\s+$/, '');
    if (body.trim() === '') return;
    if (/\t/.test(body.match(/^\s*/)[0])) throw new YamlError('tabs are not allowed for indentation', i + 1);
    lines.push({ n: i + 1, indent: body.match(/^ */)[0].length, text: body.trim() });
  });

  const result = [];
  let item = null; // current map item
  let mapIndent = 0;
  for (const { n, indent, text } of lines) {
    if (indent === 0) {
      if (!(text === '-' || text.startsWith('- '))) throw new YamlError('expected a list item starting with "- "', n);
      const rest = text.slice(1).trim();
      item = null;
      if (rest === '') { result.push(null); continue; }
      const m = /^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/.exec(rest);
      if (!m) { result.push(value(rest, n)); continue; }
      item = {};
      mapIndent = text.length - rest.length;
      item[m[1]] = value(m[2] || '', n);
      result.push(item);
    } else {
      if (!item) throw new YamlError('unexpected indentation', n);
      if (indent !== mapIndent) throw new YamlError(`bad indentation (expected ${mapIndent} spaces, got ${indent})`, n);
      const m = /^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/.exec(text);
      if (!m) throw new YamlError('expected "key: value"', n);
      if (Object.prototype.hasOwnProperty.call(item, m[1])) throw new YamlError(`duplicate key "${m[1]}"`, n);
      item[m[1]] = value(m[2] || '', n);
    }
  }
  return result;
}

module.exports = { parse, YamlError };
