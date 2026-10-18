'use strict';

const DENY_REASON = 'Gates are approved only by the human typing /mint-playbook:approve';
// A `node` invocation (same shell command: no ; & | or newline in between) of a path
// ending in `playbook` or `playbook.js`, whose first argument is the subcommand.
const APPROVAL_RE = /node(\.exe)?\s[^;&|\n\r]*?playbook(\.js)?\s+(approve|reject|reopen)\b/i;

// Returns a denial reason when the shell command would approve/reject/reopen a
// gate through the CLI, otherwise null. Quotes and backslashes are stripped first so
// that `ap""prove` and `"playbook.js" approve` cannot slip through. Mentions of the
// words in a commit message or a grep pattern are not invocations and pass.
function decideApprovalCommand(command) {
  if (typeof command !== 'string') return null;
  const flat = command.replace(/["'\\]/g, '');
  return APPROVAL_RE.test(flat) ? DENY_REASON : null;
}


const glob = require('./glob');
const state = require('./state');

const nocase = () => process.platform === 'win32';
const posix = require('node:path').posix;
// Forward slashes, collapsed dot segments; on win32 also strip NTFS aliases
// (trailing dots/spaces per segment, ":stream" suffixes) so they cannot dodge matching.
const fwd = (p) => {
  if (typeof p !== 'string') return p;
  let s = p.replace(/\\/g, '/');
  if (nocase()) {
    s = s.split('/').map((seg) => (seg === '.' || seg === '..' ? seg : seg.replace(/:.*$/, '').replace(/[. ]+$/, ''))).join('/');
  }
  return s === '' ? '' : posix.normalize(s);
};
const lc = (p) => (nocase() ? p.toLowerCase() : p);
const under = (p, dir) => lc(p) === lc(dir) || lc(p).startsWith(lc(dir) + '/');
const globs = (list) => (Array.isArray(list) ? list : []);
const strs = (...xs) => xs.map(fwd).filter((x) => typeof x === 'string');

function gateText(st, slug) {
  const step = state.currentStep(st, slug);
  const g = step.gate;
  if (!g) return 'done';
  return `${g} ${st.features[slug].gates[g].status.replace(/-/g, ' ')}`;
}

function underPlaybook(relMain, relWt) {
  return strs(relMain, relWt).some((p) => under(p, '.playbook'));
}

const APPROVED_CHANGES = 'release/approved-changes.json';

// Always-deny set: playbook state, the release manager's approved changes, protected
// globs, hash-locked approved docs.
function decideAlwaysDeny({ relMain, relWt, state: st, slug, config }) {
  const both = strs(relMain, relWt);
  if (both.length === 0) return null; // outside the repo
  const rp = typeof fwd(relWt) === 'string' ? fwd(relWt) : fwd(relMain);
  if (underPlaybook(relMain, relWt)) return `${rp} is playbook state; it is changed only through playbook.js`;
  const prot = globs(config && config.protected);
  if (both.some((p) => lc(p) === lc(APPROVED_CHANGES))) {
    return `${APPROVED_CHANGES} is edited only by the release manager, outside Claude`;
  }
  if (prot.length && both.some((p) => glob.matchAny(prot, p, { nocase: nocase() }))) {
    return `${rp} is a protected path`;
  }
  // An unknown or null activeFeature means no gate rules apply.
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
  return null;
}

// H2 (includes the always-deny set). Pure. relMain/relWt are repo-relative (or null when outside).
function decideWrite(args) {
  const { relMain, relWt, inMainSession, state: st, slug, activeTask } = args;
  const a = fwd(relMain);
  const b = fwd(relWt);
  if (typeof a !== 'string' && typeof b !== 'string') return null; // outside the repo
  const denied = decideAlwaysDeny(args);
  if (denied) return denied;
  // A builder may only touch its own worktree, never the main checkout.
  if (!inMainSession && typeof b !== 'string') return `${a} is outside this task's worktree`;
  // An unknown or null activeFeature means no gate rules apply.
  // No active feature, or a finished one (post-done policy): no gate or ownership rules.
  const f = st && st.features && st.features[slug];
  if (!f || !state.inFlight(f)) return null;
  const rp = typeof b === 'string' ? b : a;
  const isDoc = under(rp, 'docs/playbook');
  if (f.gates.tasks.status !== 'approved') {
    return isDoc ? null : `Code changes wait for the tasks gate (current: ${gateText(st, slug)})`;
  }
  if (inMainSession) return isDoc ? null : 'The orchestrator does not implement; dispatch a builder';
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

const ENV_RE = /deploy[-_]?(dev|staging|prod)/i;
const trim = (v) => (v == null ? '' : String(v).trim());

// H7. Pure. Tiered release gate: dev allows, staging asks, prod needs approved gates and a change ticket.
function decideRelease({ toolName, toolInput, state: st, slug, approvedChanges }) {
  const ti = toolInput || {};
  const version = trim(ti.version);
  const m = ENV_RE.exec(String(toolName || ''));
  if (!m) return { decision: 'ask', reason: `Release target not recognised (${toolName}): confirm` };
  const env = m[1].toLowerCase();
  if (env === 'dev') return { decision: 'allow', reason: 'Dev release allowed' };
  if (env === 'staging') return { decision: 'ask', reason: `Staging release of ${version}: confirm` };
  const gates = (st && st.features && st.features[slug] && st.features[slug].gates) || {};
  const rv = (gates.review && gates.review.status) || 'missing';
  const rl = (gates.release && gates.release.status) || 'missing';
  if (rv !== 'approved' || rl !== 'approved') {
    return { decision: 'deny', reason: `Production release needs the review and release gates approved first (current: review ${rv}, release ${rl}).` };
  }
  const ticket = trim(ti.ticket);
  const list = Array.isArray(approvedChanges) ? approvedChanges : [];
  const ok = ticket !== '' && list.some((c) => c && trim(c.ticket) === ticket && trim(c.version) === version);
  if (ok) return { decision: 'allow', reason: `Production release of ${version} matches approved change ${ticket}` };
  return { decision: 'deny', reason: `Production needs an approved change ticket for ${version} in release/approved-changes.json (release manager).` };
}

module.exports = { decideRelease, decideApprovalCommand, DENY_REASON, decideAlwaysDeny, underPlaybook, decideWrite, decideTestEdit, decideSecrets };
