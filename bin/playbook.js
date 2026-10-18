#!/usr/bin/env node
'use strict';
const feature = require('../lib/cli/feature');
const gates = require('../lib/cli/gates');
const taskCmds = require('../lib/cli/tasks');
const suiteCmds = require('../lib/cli/suite');
const configCmds = require('../lib/cli/config');

const COMMANDS = { ...feature, ...gates, ...taskCmds, ...suiteCmds, ...configCmds };
const USAGE = [
  'usage: playbook <command> [args]',
  '  init <slug> --title <t>        status [--json]         next [--json]',
  '  feature new <slug> --title <t> feature use <slug>',
  '  request|approve|reopen <gate>  reject <gate> <reason...>',
  '  tasks validate   waves [--next] [--limit n] [--json]   progress   proof',
  '  task start|set|add|lock-tests|check ...',
  '  suite baseline|check',
  '  config set <key> <value>   config get [<key>]',
  '  (all but init/feature accept --feature <slug>)',
].join('\n') + '\n';

function main(argv, ctx = {}) {
  const io = {
    cwd: ctx.cwd || process.cwd(),
    stdout: ctx.stdout || process.stdout,
    stderr: ctx.stderr || process.stderr,
  };
  const cmd = argv[2];
  if (!cmd || !Object.prototype.hasOwnProperty.call(COMMANDS, cmd)) {
    io.stderr.write(`playbook: unknown command ${cmd || ''}\n${USAGE}`);
    return 1;
  }
  try {
    const rc = COMMANDS[cmd](argv.slice(3), io);
    return typeof rc === 'number' ? rc : 0;
  } catch (e) {
    if (e && e.name === 'StoreError' && /state\.json$/.test(e.file || '')) {
      io.stderr.write(`playbook: state unreadable at ${e.file}\n`);
    } else {
      io.stderr.write(`playbook: ${e && e.message ? e.message : e}\n`);
    }
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv);

module.exports = { main };
