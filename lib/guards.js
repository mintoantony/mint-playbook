'use strict';

const DENY_REASON = 'Gates are approved only by the human typing /mint-playbook:approve';
const APPROVAL_RE = /playbook(\.js)?\s+(approve|reject|reopen)\b/;

// Returns a denial reason when the shell command would approve/reject/reopen a
// gate through the CLI, otherwise null. Quotes are stripped first so that
// `ap""prove` and `"playbook.js" approve` cannot slip through.
function decideApprovalCommand(command) {
  if (typeof command !== 'string') return null;
  const flat = command.replace(/["'\\]/g, '');
  return APPROVAL_RE.test(flat) ? DENY_REASON : null;
}


const glob = require('./glob');
const state = require('./state');

const nocase = () => process.platform === 'win32';
const fwd = (p) => (typeof p === 'string' ? p.replace(/\\/g, '/') : p);
const lc = (p) => (nocase() ? p.toLowerCase() : p);
const under = (p, dir) => lc(p) === lc(dir) || lc(p).startsWith(lc(dir) + '/');
const globs = (list) => (Array.isArray(list) ? list : []);

function gateText(st, slug) {
  const step = state.currentStep(st, slug);
  const g = step.gate;
  if (!g) return 'done';
  return `${g} ${st.features[slug].gates[g].status.replace(/-/g, ' ')}`;
}

// H2. Pure. relMain/relWt are repo-relative (or null when outside).
function decideWrite({ relMain, relWt, inMainSession, state: st, slug, activeTask, config }) {
  const a = fwd(relMain);
  const b = fwd(relWt);
  const both = [a, b].filter((x) => typeof x === 'string');
  if (both.length === 0) return null; // outside the repo
  const rp = typeof b === 'string' ? b : a;

  if (both.some((p) => under(p, '.playbook'))) {
    return `${rp} is playbook state; it is changed only through playbook.js`;
  }
  const prot = globs(config && config.protected);
  if (prot.length && both.some((p) => glob.matchAny(prot, p, { nocase: nocase() }))) {
    return `${rp} is a protected path`;
  }
  const f = st && st.features && st.features[slug];
  if (f) {
    for (const gate of state.GATES) {
      if (f.gates[gate].status !== 'approved') continue;
      const doc = `docs/playbook/${slug}/${state.gateDoc(gate)}`;
      if (both.some((p) => lc(p) === lc(doc))) {
        return `${state.gateDoc(gate)} is approved and locked; ask the user to run /mint-playbook:reopen ${gate}`;
      }
    }
  }
  if (!f) return null;
  const isDoc = both.some((p) => under(p, 'docs/playbook'));
  if (isDoc) return null;
  if (f.gates.tasks.status !== 'approved') {
    return `Code changes wait for the tasks gate (current: ${gateText(st, slug)})`;
  }
  if (inMainSession) return 'The orchestrator does not implement; dispatch a builder';
  if (!activeTask) return 'Run playbook.js task start <id> in this worktree before editing';
  const owns = globs(activeTask.owns);
  const ok = glob.matchAny(owns.concat(globs(activeTask.shared)), rp, { nocase: nocase() });
  return ok ? null : `${rp} is outside task ${activeTask.id}; it owns only ${owns.join(', ') || '(nothing)'}`;
}

// H3. Pure.
function decideTestEdit({ relWt, activeTask }) {
  if (!activeTask || activeTask.kind !== 'bugfix' || typeof relWt !== 'string') return null;
  const p = fwd(relWt);
  const hit = globs(activeTask.lockedTests).some((t) => lc(fwd(t)) === lc(p));
  return hit ? `fix the code, not the test (${p} is locked for this bug fix)` : null;
}

const SECRET_RES = [
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /gh[pousr]_[A-Za-z0-9]{36}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /sk-[A-Za-z0-9]{32,}/,
];
const ENV_OK = ['.env.example', '.env.sample', '.env.template'];

// H4. Pure.
function decideSecrets({ toolName, relMain, content }) {
  if (toolName === 'Read') {
    const p = fwd(relMain);
    if (typeof p !== 'string') return null;
    const base = lc(p.split('/').pop());
    if (base.startsWith('.env') && !ENV_OK.includes(base)) return `reading ${base} is blocked; it may hold secrets`;
    if (glob.match('**/secrets/**', lc(p))) return `reading ${p} is blocked; secrets/ may hold credentials`;
    return null;
  }
  if (typeof content !== 'string') return null;
  return SECRET_RES.some((re) => re.test(content)) ? 'content looks like a secret (key or token); use an environment variable instead' : null;
}

module.exports = { decideApprovalCommand, DENY_REASON, decideWrite, decideTestEdit, decideSecrets };
