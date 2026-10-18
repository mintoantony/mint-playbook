'use strict';

const fs = require('node:fs');

// Parses a simple leading `---\nkey: value\n---` frontmatter block.
// Values are strings, with surrounding quotes stripped, except `true` and
// `false`, which become booleans. Returns {} when there is no block.
function readFrontmatter(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    let value = line.slice(idx + 1).trim();
    if (value === 'true') {
      data[key] = true;
    } else if (value === 'false') {
      data[key] = false;
    } else {
      if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
        value = value.slice(1, -1);
      }
      data[key] = value;
    }
  }
  return data;
}

module.exports = { readFrontmatter };
