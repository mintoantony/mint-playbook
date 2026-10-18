'use strict';
const test = require('node:test');
const assert = require('node:assert');
const yaml = require('../lib/yaml-lite');

const example = `- id: T1
  title: Project skeleton and shared types
  covers: [R1]
  depends_on: [T0]
  owns: ["package.json", "src/types/**", 'test/types/**']
  shared: []                               # append-only files
  proof: "npm test -- types"
  kind: feature                            # feature | bugfix
`;

test('parses the tasks example', () => {
  assert.deepStrictEqual(yaml.parse(example), [{
    id: 'T1', title: 'Project skeleton and shared types', covers: ['R1'], depends_on: ['T0'],
    owns: ['package.json', 'src/types/**', 'test/types/**'], shared: [],
    proof: 'npm test -- types', kind: 'feature',
  }]);
});

test('multiple items, scalars, comments', () => {
  const r = yaml.parse('# top\n- id: A\n  n: 3\n  f: 1.5\n  b: true\n  z: null\n  q: "a # b"\n\n- id: B\n');
  assert.deepStrictEqual(r, [{ id: 'A', n: 3, f: 1.5, b: true, z: null, q: 'a # b' }, { id: 'B' }]);
});

test('flow arrays with numbers and commas in quotes', () => {
  assert.deepStrictEqual(yaml.parse('- a: [1, "x, y", true]\n'), [{ a: [1, 'x, y', true] }]);
});

test('bad indent throws YamlError with line 3', () => {
  assert.throws(() => yaml.parse('- id: T1\n  covers: [R1]\n   bad: x\n'), (e) => {
    return e instanceof yaml.YamlError && e.line === 3;
  });
});

test('unterminated flow array / quote throw with line', () => {
  assert.throws(() => yaml.parse('- a: [1, 2\n'), (e) => e instanceof yaml.YamlError && e.line === 1);
  assert.throws(() => yaml.parse('- a: "oops\n'), (e) => e instanceof yaml.YamlError && e.line === 1);
});

test('empty text parses to empty list', () => {
  assert.deepStrictEqual(yaml.parse('\n# nothing\n'), []);
});
