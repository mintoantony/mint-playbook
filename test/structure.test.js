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

test('hooks.json wires exactly the expected events, matchers and scripts', () => {
  const hooksDir = path.join(ROOT, 'hooks');
  const cfg = readJson(path.join(hooksDir, 'hooks.json'));
  const actual = [];
  for (const [event, entries] of Object.entries(cfg.hooks)) {
    for (const entry of entries) {
      for (const h of entry.hooks) {
        assert.equal(h.type, 'command');
        assert.ok(h.command.startsWith('node "${CLAUDE_PLUGIN_ROOT}/hooks/'), `command form: ${h.command}`);
        const m = /\/hooks\/([^"]+)"/.exec(h.command);
        assert.ok(m, `script path parsed from ${h.command}`);
        assert.ok(fs.existsSync(path.join(hooksDir, m[1])), `hooks/${m[1]} exists`);
        actual.push(`${event}|${entry.matcher || ''}|${m[1]}`);
      }
    }
  }
  const expected = [
    'SessionStart||session-start.js',
    'PreToolUse|Bash|PowerShell|approval-guard.js',
    'PreToolUse|Edit|Write|MultiEdit|NotebookEdit|Read|pre-write.js',
    'PostToolUse|Edit|Write|MultiEdit|post-edit.js',
    'SubagentStop||subagent-stop.js',
    'PreToolUse|mcp__.*deploy.*__release|release-gate.js',
  ];
  assert.deepEqual(actual.sort(), expected.sort());
});

test('approve, reject and reopen commands are human-only', () => {
  for (const name of ['approve', 'reject', 'reopen']) {
    const fm = readFrontmatter(path.join(ROOT, 'commands', `${name}.md`));
    assert.equal(fm['disable-model-invocation'], true, `${name} disables model invocation`);
  }
});

// ---- Document chain (Task 12) ----

const tasksLib = require('../lib/tasks');

const CHAIN_SKILLS = ['playbook', 'capture-intent', 'write-spec', 'plan-mode', 'split-tasks'];
const CHAIN_TEMPLATES = {
  'capture-intent': 'intent.md',
  'write-spec': 'spec.md',
  'plan-mode': 'plan.md',
  'split-tasks': 'tasks.md',
};
const CHAIN_AGENTS = ['intent-analyst', 'spec-architect', 'planner', 'task-splitter'];
// No commands/playbook.md: the playbook skill is itself /mint-playbook:playbook, and a command
// with the same name shadows the skill so its body never loads.
const CHAIN_COMMANDS = ['intent', 'spec', 'plan', 'tasks', 'status'];

// Spec 7.8, exact.
const AGENT_TOOLS = {
  'intent-analyst': ['Read', 'Write', 'Edit'],
  'spec-architect': ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch'],
  planner: ['Read', 'Glob', 'Grep', 'Write', 'Edit'],
  'task-splitter': ['Read', 'Write', 'Edit'],
  builder: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
  verifier: ['Bash', 'Read', 'Glob', 'Grep'],
  reviewer: ['Read', 'Grep', 'Glob'],
  'security-reviewer': ['Read', 'Grep', 'Glob'],
  'incident-analyst': ['Read', 'Grep', 'Glob'],
};

// Spec 9, by template file name.
const TEMPLATE_HEADINGS = {
  'intent.md': ['## Problem', '## Proposed outcome', '## Affected users and systems', '## Constraints', '## Open questions'],
  'spec.md': ['## Current state', '## Requirements', '## Design', '## Constraints and controls', '## Areas of concern', '## Open questions'],
  'plan.md': ['## Files that change', '## Order of work', '## Risks', '## Proof'],
};

function hasHeading(text, heading) {
  return text.split(/\r?\n/).some((l) => l.trimEnd() === heading);
}

test('document chain skills, templates, agents and commands exist', () => {
  for (const s of CHAIN_SKILLS) {
    assert.ok(fs.existsSync(path.join(ROOT, 'skills', s, 'SKILL.md')), `skills/${s}/SKILL.md exists`);
  }
  for (const [s, t] of Object.entries(CHAIN_TEMPLATES)) {
    assert.ok(fs.existsSync(path.join(ROOT, 'skills', s, 'templates', t)), `skills/${s}/templates/${t} exists`);
  }
  for (const a of CHAIN_AGENTS) {
    assert.ok(fs.existsSync(path.join(ROOT, 'agents', `${a}.md`)), `agents/${a}.md exists`);
  }
  for (const c of CHAIN_COMMANDS) {
    assert.ok(fs.existsSync(path.join(ROOT, 'commands', `${c}.md`)), `commands/${c}.md exists`);
  }
});

test('every agent is in the design table and its tools match exactly', () => {
  for (const file of listMarkdown(path.join(ROOT, 'agents'))) {
    const fm = readFrontmatter(path.join(ROOT, 'agents', file));
    const name = file.replace(/\.md$/, '');
    assert.equal(fm.name, name, `agents/${file} name matches file`);
    assert.ok(AGENT_TOOLS[name], `agents/${file} is listed in spec 7.8`);
    const tools = String(fm.tools).split(',').map((x) => x.trim()).filter(Boolean);
    assert.deepEqual([...tools].sort(), [...AGENT_TOOLS[name]].sort(), `agents/${file} tools`);
  }
});

test('templates carry the spec 9 section headings for their kind', () => {
  const skillsDir = path.join(ROOT, 'skills');
  const seen = new Set();
  for (const s of listSubdirs(skillsDir)) {
    for (const t of listMarkdown(path.join(skillsDir, s, 'templates'))) {
      const want = TEMPLATE_HEADINGS[t];
      if (!want) continue;
      seen.add(t);
      const text = fs.readFileSync(path.join(skillsDir, s, 'templates', t), 'utf8');
      for (const h of want) assert.ok(hasHeading(text, h), `skills/${s}/templates/${t} has "${h}"`);
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(TEMPLATE_HEADINGS).sort(), 'intent, spec and plan templates found');
});

test('intent template has Author and Status header fields', () => {
  const text = fs.readFileSync(path.join(ROOT, 'skills/capture-intent/templates/intent.md'), 'utf8');
  assert.match(text, /^Author:/m);
  assert.match(text, /^Status:/m);
});

test('tasks template parses, has a bootstrap T0, and validates against the spec template', () => {
  const md = fs.readFileSync(path.join(ROOT, 'skills/split-tasks/templates/tasks.md'), 'utf8');
  const { tasks, errors } = tasksLib.parse(md);
  assert.deepEqual(errors, []);
  const t0 = tasks.find((t) => t.id === 'T0');
  assert.ok(t0, 'T0 present');
  assert.equal(t0.kind, 'bootstrap');
  assert.ok(t0.owns.includes('CLAUDE.md'), 'T0 owns CLAUDE.md');
  const spec = fs.readFileSync(path.join(ROOT, 'skills/write-spec/templates/spec.md'), 'utf8');
  const ids = tasksLib.requirementIds(spec);
  assert.ok(ids.length > 0, 'spec template lists requirement ids');
  assert.deepEqual(tasksLib.validate(tasks, ids), []);
});

test('playbook skill can start a new feature when one is active', () => {
  const text = fs.readFileSync(path.join(ROOT, 'skills/playbook/SKILL.md'), 'utf8');
  assert.ok(text.includes('feature new'), 'mentions feature new');
  assert.ok(text.includes('feature use'), 'mentions feature use');
});

test('chain skills call the CLI relative to the skill base dir', () => {
  for (const s of CHAIN_SKILLS) {
    const text = fs.readFileSync(path.join(ROOT, 'skills', s, 'SKILL.md'), 'utf8');
    assert.ok(text.includes('../../bin/playbook.js'), `skills/${s} names the CLI path`);
  }
});

test('no skill or agent tells the model to run approve, reject or reopen', () => {
  const files = [];
  for (const s of listSubdirs(path.join(ROOT, 'skills'))) files.push(path.join(ROOT, 'skills', s, 'SKILL.md'));
  for (const a of listMarkdown(path.join(ROOT, 'agents'))) files.push(path.join(ROOT, 'agents', a));
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(text, /playbook\.js"?\s+(approve|reject|reopen)\b/, `${path.relative(ROOT, f)}`);
  }
});

test('no command shares a name with a skill (the command would shadow the skill)', () => {
  const skills = new Set(listSubdirs(path.join(ROOT, 'skills')));
  for (const c of listMarkdown(path.join(ROOT, 'commands'))) {
    const name = c.replace(/\.md$/, '');
    assert.ok(!skills.has(name), `commands/${c} collides with skills/${name}`);
  }
});

test('chain commands are model-invocable wrappers', () => {
  for (const c of CHAIN_COMMANDS) {
    const fm = readFrontmatter(path.join(ROOT, 'commands', `${c}.md`));
    assert.equal(fm['disable-model-invocation'], undefined, `commands/${c}.md stays model-invocable`);
  }
});

test('frontmatter values are single-line (no block scalars)', () => {
  const files = [];
  for (const s of listSubdirs(path.join(ROOT, 'skills'))) files.push(path.join(ROOT, 'skills', s, 'SKILL.md'));
  for (const a of listMarkdown(path.join(ROOT, 'agents'))) files.push(path.join(ROOT, 'agents', a));
  for (const c of listMarkdown(path.join(ROOT, 'commands'))) files.push(path.join(ROOT, 'commands', c));
  for (const f of files) {
    for (const [k, v] of Object.entries(readFrontmatter(f))) {
      assert.ok(!/^[>|][-+]?$/.test(String(v)), `${path.relative(ROOT, f)} ${k} is single-line`);
    }
  }
});

// ---- Bootstrap (Task 13) ----

test('CLAUDE.md template has the four sections and the verification sentences', () => {
  const text = fs.readFileSync(path.join(ROOT, 'skills/claude-md/templates/CLAUDE.md'), 'utf8');
  for (const h of ['## Commands', '## Conventions', '## Architecture', '## Things Claude gets wrong']) {
    assert.ok(hasHeading(text, h), h);
  }
  assert.ok(text.includes('If a test fails, fix the code, not the test.'));
  assert.ok(text.includes('Run all three before reporting any task complete, and paste the output.'));
});

test('bootstrap templates exist and managed settings example is valid', () => {
  const dir = path.join(ROOT, 'skills/claude-md/templates');
  for (const f of ['REVIEW.md', '.gitattributes', 'managed-settings.example.json']) {
    assert.ok(fs.existsSync(path.join(dir, f)), f);
  }
  assert.match(fs.readFileSync(path.join(dir, '.gitattributes'), 'utf8'), /^\* text=auto/m);
  const ms = JSON.parse(fs.readFileSync(path.join(dir, 'managed-settings.example.json'), 'utf8'));
  for (const d of ['Read(.env*)', 'Read(./secrets/**)', 'Bash(curl *)', 'Bash(wget *)']) {
    assert.ok(ms.permissions.deny.includes(d), d);
  }
  assert.ok(ms.permissions.allow.includes('Bash(git *)'));
  assert.equal(ms.disableBypassPermissionsMode, 'disable');
  assert.equal(ms.sandbox.enabled, true);
  assert.equal(ms.allowManagedHooksOnly, true);
  assert.equal(ms.allowManagedMcpServersOnly, true);
  assert.ok(ms['//']);
});

test('policy-skills and feedback-loop skills carry their key rules', () => {
  const ps = fs.readFileSync(path.join(ROOT, 'skills/policy-skills/SKILL.md'), 'utf8');
  assert.ok(ps.includes('A skill is a control, though an advisory one'));
  assert.ok(fs.existsSync(path.join(ROOT, 'skills/policy-skills/templates/SKILL.md')));
  const fl = fs.readFileSync(path.join(ROOT, 'skills/feedback-loop/SKILL.md'), 'utf8');
  assert.ok(fl.includes('task lock-tests'));
  assert.ok(fl.includes('If a test fails, fix the code, not the test.'));
  assert.ok(fs.existsSync(path.join(ROOT, 'commands/bootstrap.md')));
});

// ---- Parallel orchestrator (Task 14) ----

test('run-tasks skill, builder and verifier agents, build and verify commands exist', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'skills/run-tasks/SKILL.md')), 'skills/run-tasks/SKILL.md');
  for (const a of ['builder', 'verifier']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'agents', `${a}.md`)), `agents/${a}.md`);
  }
  for (const c of ['build', 'verify']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'commands', `${c}.md`)), `commands/${c}.md`);
  }
});

test('run-tasks skill carries the dispatch, merge and check procedure', () => {
  const text = fs.readFileSync(path.join(ROOT, 'skills/run-tasks/SKILL.md'), 'utf8');
  for (const s of [
    'isolation: "worktree"', 'git merge --abort', 'git reset --hard <PRE>', 'task scope', 'HEAD_BEFORE', 'merge-base --is-ancestor', 'suite check', 'suite baseline',
    'task check', 'waves --next --json', 'task set', 'progress', '../../bin/playbook.js',
    'mint-playbook:builder', 'mint-playbook:verifier', 'PLAYBOOK_PORT_OFFSET', 'git worktree remove --force',
    'task start', 'git clean -fd', 'info/exclude',
  ]) {
    assert.ok(text.includes(s), `run-tasks mentions ${s}`);
  }
});

test('builder and verifier tools match exactly; verifier ends with "Do not fix anything."', () => {
  const b = readFrontmatter(path.join(ROOT, 'agents/builder.md'));
  assert.deepEqual(String(b.tools).split(',').map((x) => x.trim()), ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep']);
  const v = readFrontmatter(path.join(ROOT, 'agents/verifier.md'));
  assert.deepEqual(String(v.tools).split(',').map((x) => x.trim()), ['Bash', 'Read', 'Glob', 'Grep']);
  const body = fs.readFileSync(path.join(ROOT, 'agents/verifier.md'), 'utf8');
  assert.ok(body.trimEnd().endsWith('Do not fix anything.'), 'verifier body ends with "Do not fix anything."');
});

test('builder agent carries the task rules and the proof report', () => {
  const text = fs.readFileSync(path.join(ROOT, 'agents/builder.md'), 'utf8');
  for (const s of ['task start', 'proof', 'PLAYBOOK_PORT_OFFSET', 'If a test fails, fix the code, not the test.', 'task lock-tests']) {
    assert.ok(text.includes(s), `builder mentions ${s}`);
  }
});

test('build command invokes the run-tasks skill', () => {
  const text = fs.readFileSync(path.join(ROOT, 'commands/build.md'), 'utf8');
  assert.ok(text.includes('mint-playbook:run-tasks'));
});

test('verifier runs only read-only git; builder never stages with git add -A', () => {
  const v = fs.readFileSync(path.join(ROOT, 'agents/verifier.md'), 'utf8');
  assert.ok(v.includes('Run only read-only git commands'), 'verifier read-only git rule');
  const b = fs.readFileSync(path.join(ROOT, 'agents/builder.md'), 'utf8');
  assert.ok(b.includes('never `git add -A`'), 'builder stages only owned paths');
  const sp = fs.readFileSync(path.join(ROOT, 'skills/split-tasks/SKILL.md'), 'utf8');
  assert.ok(sp.includes('T0 owns `.gitignore`, never `.gitignore.append`'), 'split-tasks maps .gitignore.append to .gitignore');
});

// ---- Review, release and PR (Task 15) ----

test('review and release skills, agents, commands and templates exist', () => {
  for (const f of [
    'skills/pr-review/SKILL.md', 'skills/release-gate/SKILL.md',
    'skills/pr-review/templates/workflows/claude-review.yml', 'skills/pr-review/templates/workflows/policy-check.yml',
    'skills/release-gate/templates/.mcp.json', 'skills/release-gate/templates/approved-changes.json',
    'agents/reviewer.md', 'agents/security-reviewer.md', 'commands/review.md', 'commands/release.md',
  ]) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
});

test('.mcp.json template has deploy-dev/staging/prod http servers with bearer tokens from env', () => {
  const m = readJson(path.join(ROOT, 'skills/release-gate/templates/.mcp.json'));
  for (const env of ['dev', 'staging', 'prod']) {
    const s = m.mcpServers[`deploy-${env}`];
    assert.ok(s, `deploy-${env}`);
    assert.equal(s.type, 'http');
    assert.equal(s.headers.Authorization, `Bearer \${DEPLOY_${env.toUpperCase()}_TOKEN}`);
  }
});

test('approved-changes template parses as an array and the skill documents the entry shape', () => {
  assert.ok(Array.isArray(readJson(path.join(ROOT, 'skills/release-gate/templates/approved-changes.json'))));
  const s = fs.readFileSync(path.join(ROOT, 'skills/release-gate/SKILL.md'), 'utf8');
  assert.ok(s.includes('{ "ticket": "CHG-123", "version": "1.4.0" }'));
});

test('base branch is stored in git config by run-tasks and read by pr-review and release-gate', () => {
  for (const s of ['run-tasks', 'pr-review', 'release-gate']) {
    const t = fs.readFileSync(path.join(ROOT, 'skills', s, 'SKILL.md'), 'utf8');
    assert.ok(t.includes('playbookBase'), s + ' mentions playbookBase');
  }
  assert.ok(fs.readFileSync(path.join(ROOT, 'skills/run-tasks/SKILL.md'), 'utf8').includes('git config branch.playbook/<slug>.playbookBase'));
});

test('claude-review workflow has a review job and a tag-mode job without prompt', () => {
  const t = fs.readFileSync(path.join(ROOT, 'skills/pr-review/templates/workflows/claude-review.yml'), 'utf8');
  const [review, respond] = t.split(/^  respond:/m);
  assert.ok(respond, 'respond job exists');
  assert.ok(review.includes('prompt:') && review.includes('REVIEW.md'));
  assert.ok(!respond.includes('prompt:'), 'tag mode has no prompt');
  assert.ok(respond.includes('contents: write') && respond.includes('github.event.issue.pull_request'));
  assert.ok(respond.includes('pull_request_review_comment'));
});

test('workflow templates trigger on pull_request; review points at REVIEW.md', () => {
  const dir = path.join(ROOT, 'skills/pr-review/templates/workflows');
  for (const f of ['claude-review.yml', 'policy-check.yml']) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.match(text, /^on:/m, `${f} has on:`);
    assert.ok(text.includes('pull_request'), `${f} has pull_request`);
  }
  assert.ok(fs.readFileSync(path.join(dir, 'claude-review.yml'), 'utf8').includes('REVIEW.md'));
});

test('pr-review skill runs both reviewers in parallel, maps fix tasks, and never approves', () => {
  const t = fs.readFileSync(path.join(ROOT, 'skills/pr-review/SKILL.md'), 'utf8');
  for (const s of ['mint-playbook:reviewer', 'mint-playbook:security-reviewer', 'task add F', 'request review',
    'review-report.md', 'suite check', 'claude-md/templates/REVIEW.md', '/mint-playbook:approve review', '../../bin/playbook.js']) {
    assert.ok(t.includes(s), `pr-review mentions ${s}`);
  }
});

test('release-gate skill pushes only after approval and checks remote and gh auth', () => {
  const t = fs.readFileSync(path.join(ROOT, 'skills/release-gate/SKILL.md'), 'utf8');
  for (const s of ['git remote', 'gh auth status', 'git push -u origin playbook/<slug>', 'gh pr create --base <base> --head playbook/<slug>',
    '--body-file', 'request release', '/mint-playbook:approve release', 'approved-changes.json', '../../bin/playbook.js']) {
    assert.ok(t.includes(s), `release-gate mentions ${s}`);
  }
  assert.ok(t.indexOf('After approval') < t.indexOf('git push -u'), 'push comes after the approval section');
});

test('review and release commands call their skills', () => {
  assert.ok(fs.readFileSync(path.join(ROOT, 'commands/review.md'), 'utf8').includes('mint-playbook:pr-review'));
  assert.ok(fs.readFileSync(path.join(ROOT, 'commands/release.md'), 'utf8').includes('mint-playbook:release-gate'));
});
