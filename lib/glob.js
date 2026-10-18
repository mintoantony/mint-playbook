'use strict';

const cache = new Map();

function compile(pattern, nocase) {
  const key = (nocase ? 'i:' : 's:') + pattern;
  let re = cache.get(key);
  if (re) return re;
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
  re = new RegExp('^' + src + '$', nocase ? 'i' : '');
  cache.set(key, re);
  return re;
}

function match(pattern, relPath, opts) {
  return compile(String(pattern), !!(opts && opts.nocase)).test(relPath);
}

function matchAny(patterns, relPath, opts) {
  return patterns.some((p) => match(p, relPath, opts));
}

module.exports = { match, matchAny };
