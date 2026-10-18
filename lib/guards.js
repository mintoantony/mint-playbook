'use strict';

const DENY_REASON = 'Gates are approved only by the human typing /mint-playbook:approve';
const APPROVAL_RE = /playbook(\.js)?\s+(approve|reject|reopen)\b/;

// Returns a denial reason when the shell command would approve/reject/reopen a
// gate through the CLI, otherwise null. Quotes are stripped first so that
// `ap""prove` and `"playbook.js" approve` cannot slip through.
function decideApprovalCommand(command) {
  if (typeof command !== 'string') return null;
  const flat = command.replace(/["']/g, '');
  return APPROVAL_RE.test(flat) ? DENY_REASON : null;
}

module.exports = { decideApprovalCommand, DENY_REASON };
