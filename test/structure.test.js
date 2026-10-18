'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readFrontmatter } = require('./helpers/frontmatter.js');

const ROOT = path.join(__dirname, '..');
const pluginDir = path.join(ROOT, '.claude-plugin');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function listSubdirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

function listMarkdown(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.md'))
    .map((d) => d.name)
    .sort();
}

test('plugin.json parses and has the required fields', () => {
  const plugin = readJson(path.join(pluginDir, 'plugin.json'));
  assert.equal(plugin.name, 'mint-playbook');
  assert.ok(typeof plugin.version === 'string' && plugin.version.length > 0, 'version present');
  assert.ok(typeof plugin.description === 'string' && plugin.description.length > 0, 'description present');
  assert.ok(plugin.author && typeof plugin.author.name === 'string', 'author.name present');
});

test('marketplace.json lists plugin mint-playbook with source ./', () => {
  const marketplace = readJson(path.join(pluginDir, 'marketplace.json'));
  const entry = (marketplace.plugins || []).find((p) => p.name === 'mint-playbook');
  assert.ok(entry, 'plugin mint-playbook is listed');
  assert.equal(entry.source, './');
});

test('every skills/*/SKILL.md has name matching its dir and a non-empty description', () => {
  for (const dirName of listSubdirs(path.join(ROOT, 'skills'))) {
    const file = path.join(ROOT, 'skills', dirName, 'SKILL.md');
    assert.ok(fs.existsSync(file), `skills/${dirName}/SKILL.md exists`);
    const fm = readFrontmatter(file);
    assert.equal(fm.name, dirName, `skills/${dirName}/SKILL.md name matches dir`);
    assert.ok(typeof fm.description === 'string' && fm.description.trim().length > 0,
      `skills/${dirName}/SKILL.md has a description`);
  }
});

test('every agents/*.md has name, description and tools', () => {
  for (const file of listMarkdown(path.join(ROOT, 'agents'))) {
    const fm = readFrontmatter(path.join(ROOT, 'agents', file));
    for (const key of ['name', 'description', 'tools']) {
      assert.ok(fm[key] !== undefined && fm[key] !== '', `agents/${file} has ${key}`);
    }
  }
});

test('every commands/*.md has a description', () => {
  for (const file of listMarkdown(path.join(ROOT, 'commands'))) {
    const fm = readFrontmatter(path.join(ROOT, 'commands', file));
    assert.ok(fm.description !== undefined && fm.description !== '', `commands/${file} has description`);
  }
});
