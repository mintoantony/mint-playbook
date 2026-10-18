'use strict';

// Standalone helpers for run-evals.js. The glob logic below is inlined from the
// mint-playbook plugin's lib/glob.js (a project has no plugin lib); keep the
// semantics identical: `**`, `*`, `?`, backslash to slash, case-insensitive on win32.

function compile(pattern, nocase) {
  let src = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') { src += '(?:.*/)?'; i += 2; } else { src += '.*'; i += 1; }
      } else src += '[^/]*';
    } else if (c === '?') src += '[^/]';
    else src += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + src + '$', nocase ? 'i' : '');
}

function norm(p) {
  return String(p).replace(/\\/g, '/');
}

// Returns the changed files that no may_change pattern allows.
function outsideMayChange(changedFiles, mayChange) {
  const nocase = process.platform === 'win32';
  const res = (mayChange || []).map((p) => compile(norm(p), nocase));
  return (changedFiles || []).map(norm).filter((f) => f && !res.some((re) => re.test(f)));
}

// formatResult(name, passed, total): `passed` is the number of passing checks,
// or a boolean (true = all passed). Optional 4th arg: passing count when `passed` is false.
function formatResult(name, passed, total, passedCount) {
  let count;
  if (typeof passed === 'number') count = passed;
  else if (passed) count = total;
  else count = passedCount || 0;
  const ok = count === total && passed !== false;
  return `${ok ? 'PASS' : 'FAIL'} ${name} (${count}/${total} checks)`;
}

module.exports = { outsideMayChange, formatResult };
