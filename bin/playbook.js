#!/usr/bin/env node
'use strict';
const feature = require('../lib/cli/feature');
const gates = require('../lib/cli/gates');

const COMMANDS = { ...feature, ...gates };
const USAGE = [
  'usage: playbook <command> [args]',
  '  init <slug> --title <t>        status [--json]         next [--json]',
  '  feature new <slug> --title <t> feature use <slug>',
  '  request|approve|reopen <gate>  reject <gate> <reason...>',
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
    COMMANDS[cmd](argv.slice(3), io);
    return 0;
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
