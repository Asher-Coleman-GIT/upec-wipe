'use strict';
/**
 * lib/email-step.js
 *
 * Phase 2: privacy requests by email (docs/superpowers/specs/
 * 2026-10-11-phase2-email-design.md). Builds the plan, checks the setup and
 * sends one email at a time through an injected transport, recording each
 * send in state as it happens. No network here: the caller supplies the
 * transport and passes the egress gate first.
 */
const { stateKey } = require('./config');
const { smtpFromLeakReason } = require('./relay');
const { buildUcpaRequest } = require('./email');
const { egressRequired, proxyFromConfig } = require('./egress');
const { normalizeUsState } = require('./us-state');

const REPLY_OUTCOMES = ['honored', 'refused', 'verify', 'none', 'bounced'];
const lower = (s) => String(s || '').trim().toLowerCase();

function checkEmailSetup({ config, persons, isTTY, preview }) {
  const smtp = config && config.email && config.email.smtp;
  if (!smtp || !smtp.host || !smtp.user || !smtp.pass) return 'add an email.smtp block (host, port, user, pass, from) to config.json';
  for (const person of persons || []) {
    const leak = smtpFromLeakReason(smtp, person);
    if (leak) return leak;
  }
  if (lower(smtp.user) !== lower(smtp.from)) return 'email.smtp.user and email.smtp.from must be the same dedicated address';
  // SMTP connects from this machine: only a system VPN (Mullvad) covers it.
  let proxy = null;
  try { proxy = proxyFromConfig(config); } catch (_) { proxy = 'invalid'; }
  if (proxy) return 'network.proxy covers the browser only, so SMTP would leave from your real IP; use the Mullvad app instead of a proxy for the email step';
  if (!egressRequired(config)) return 'network.required is false, so nothing would check that SMTP goes out via Mullvad';
  if (!preview && !isTTY) return 'the email step needs an interactive terminal to confirm with SEND';
  return null;
}

function buildEmailPlan({ targets, brokers, persons, state, from, maxPerRun }) {
  const sent = (state && state.emailSent) || {};
  const failures = (state && state.emailFailures) || {};
  const replies = (state && state.emailReplies) || {};
  const all = [
    ...(targets || []).map(t => ({ name: t.name, to: t.to, basis: t.basis })),
    ...(brokers || []).filter(b => b.method === 'email' && b.emailTo).map(b => ({ name: b.name, to: lower(b.emailTo), basis: null })),
  ];
  const plan = { items: [], unknown: [], manual: [], notes: [] };
  (persons || []).forEach((person, idx) => {
    const st = normalizeUsState(person.state);
    if (!st) { plan.notes.push(`person #${idx + 1} has no US state in config.json, so no email requests are sent for them`); return; }
    const { subject, body } = buildUcpaRequest(person, from);
    const addresses = new Set();
    for (const t of all) {
      // A Utah-only basis gives nothing to someone who lives elsewhere.
      if (t.basis && t.basis.kind === 'utah' && st !== 'UT') continue;
      // One address, one email: a catalog record and a brokers.js entry can share it.
      if (addresses.has(t.to)) continue;
      addresses.add(t.to);
      const key = stateKey(t.name, person, persons.length);
      const item = { key, name: t.name, to: t.to, basis: t.basis, subject, body };
      const s = sent[key];
      if (s && s.status === 'unknown') { plan.unknown.push(item); continue; }
      if (s) continue;
      if ((failures[key] || 0) >= 2 || (replies[key] && replies[key].outcome === 'bounced')) { plan.manual.push(item); continue; }
      plan.items.push(item);
    }
  });
  plan.items = plan.items.slice(0, maxPerRun);
  return plan;
}

const CONNECTION_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ETLS', 'EPROTOCOL', 'ECONNRESET', 'ECONNREFUSED']);
function classifySmtpError(err) {
  const code = err && err.responseCode;
  const msg = String((err && err.message) || '');
  if ((err && err.code === 'EAUTH') || code === 534 || code === 535) return 'auth';
  if (code === 421 || code === 452 || /daily user sending limit|quota|rate limit|too many/i.test(msg)) return 'quota';
  // No server reply at all (network down, VPN dropped): not the broker's fault,
  // so it must not count toward moving the broker to manual.
  if (!code || CONNECTION_CODES.has(err && err.code)) return 'connection';
  return 'broker';
}

const STOP_TEXT = {
  auth: 'the mailbox refused the login',
  quota: 'the mailbox sending limit was reached',
  connection: 'the mail server could not be reached',
};

async function sendEmailPlan(items, { transport, from, paceMs = 45000, sleep, state, save, log = () => {}, now = () => new Date().toISOString(), beforeSend = async () => {}, afterSend = () => {} }) {
  state.emailSent = state.emailSent || {};
  state.emailFailures = state.emailFailures || {};
  const result = { sent: [], failed: [], stopped: null };
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (i > 0) await sleep(paceMs);
    // Re-checked before every send: a VPN that drops mid-run must not let the
    // next email leave from the real IP (Gmail records the client IP).
    try {
      await beforeSend();
    } catch (err) {
      result.stopped = 'egress';
      log(`  stopped before ${it.name}: the network check failed (Mullvad not connected); nothing more sent`);
      break;
    }
    // Written before the send: a run that dies here leaves "unknown", and the
    // next run asks instead of guessing.
    state.emailSent[it.key] = { to: it.to, at: now(), status: 'unknown' };
    save();
    let info;
    try {
      info = await transport.sendMail({ from, to: it.to, replyTo: from, subject: it.subject, text: it.body });
    } catch (err) {
      if (err && err.fatal) throw err;
      delete state.emailSent[it.key];
      const kind = classifySmtpError(err);
      const code = (err && (err.responseCode || err.code)) || 'error';
      if (kind !== 'broker') {
        save();
        result.stopped = kind;
        log(`  stopped at ${it.name}: ${STOP_TEXT[kind]} (${code})`);
        break;
      }
      state.emailFailures[it.key] = (state.emailFailures[it.key] || 0) + 1;
      save();
      result.failed.push({ ...it, code });
      log(`  error ${it.name}: not delivered (${code})`);
      continue;
    }
    state.emailSent[it.key] = { to: it.to, at: now(), messageId: (info && info.messageId) || null };
    save();
    afterSend(it);
    result.sent.push(it);
    log(`  sent  ${it.name} -> ${it.to}`);
  }
  return result;
}

// Status for --list and the dashboard. Keys are "Name" or, with several
// persons, "Name|First Last" (lib/config stateKey).
function emailStatus(state, name) {
  const pick = (map) => Object.entries((state && state[map]) || {}).filter(([k]) => k === name || k.startsWith(`${name}|`)).map(([, v]) => v);
  const sent = pick('emailSent');
  const replies = pick('emailReplies').sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const done = sent.filter(v => v.status !== 'unknown').sort((a, b) => String(b.at).localeCompare(String(a.at)));
  let status = 'not sent';
  if (done.length) status = `sent ${String(done[0].at).slice(0, 10)}${sent.length > 1 ? ` (${done.length})` : ''}`;
  else if (sent.length) status = 'unknown';
  return { status, reply: replies.length ? `${replies[0].outcome} ${String(replies[0].at).slice(0, 10)}` : null };
}

function markUnknownAsSent(state, item, now = () => new Date().toISOString()) {
  state.emailSent = state.emailSent || {};
  state.emailSent[item.key] = { to: item.to, at: now(), messageId: null, assumed: true };
}

function recordReply(state, key, outcome, now = () => new Date().toISOString()) {
  if (!REPLY_OUTCOMES.includes(outcome)) throw new Error(`outcome must be one of: ${REPLY_OUTCOMES.join(', ')}`);
  state.emailReplies = state.emailReplies || {};
  state.emailReplies[key] = { outcome, at: now() };
}

/**
 * The shared tail of the --email and --know steps: list the items, print the
 * letter, then either stop (preview) or ask for SEND, pass the egress gate and
 * send at the configured pace. `items` must not be empty. Returns the exit code.
 */
async function confirmAndSend(items, { config, state, save, preview, ask, log, makeTransport, ensureEgress, sleep, label = 'email request(s)', rerun = '--email', onSent }) {
  const emailCfg = config.email;
  const from = emailCfg.smtp.from;
  const paceMs = Math.max(1, Number(emailCfg.paceSeconds) || 45) * 1000;

  log(`${items.length} ${label} from ${from}:`);
  for (const it of items) {
    log(`  ${it.name.padEnd(40)} ${it.to}`);
    if (it.basis) log(`      basis (${it.basis.kind}): "${it.basis.quote}"  ${it.basis.url}`);
  }
  log(`\nSubject: ${items[0].subject}\n\n${items[0].body}\n`);
  if (preview) {
    for (const it of items.slice(1)) log(`--- ${it.name} ---\n${it.body}\n`);
    log('Preview: nothing sent.');
    return 0;
  }

  const minutes = Math.ceil(((items.length - 1) * paceMs) / 60000);
  const answer = String(await ask(`Type SEND to send ${items.length} email(s), one every ${paceMs / 1000}s (about ${minutes} min): `)).trim();
  if (answer !== 'SEND') { log('Not sent.'); return 1; }

  await ensureEgress(config);
  const result = await sendEmailPlan(items, { transport: makeTransport(emailCfg.smtp), from, paceMs, sleep, state, save, log, beforeSend: () => ensureEgress(config), afterSend: onSent });
  log(`\nEmail requests: ${result.sent.length} sent, ${result.failed.length} not delivered.`);
  if (result.stopped === 'auth') log('Stopped: the mailbox refused the login. Check email.smtp.user and the app password (2-step verification must be on).');
  if (result.stopped === 'connection') log(`Stopped: the mail server could not be reached. Check the connection and run ${rerun} again; nothing was counted against any broker.`);
  if (result.stopped === 'egress') log(`Stopped: Mullvad is not connected. Reconnect and run ${rerun} again; it carries on where it stopped.`);
  if (result.stopped === 'quota') log(`Stopped: the mailbox hit its sending limit. Run ${rerun} again tomorrow; it carries on where it stopped.`);
  return result.stopped ? 1 : 0;
}

async function runEmailStep(deps) {
  const { config, persons, state, save, targets, brokers, preview, isTTY, ask, log } = deps;
  log('\n-- Email requests ------------------------------------------');
  const problem = checkEmailSetup({ config, persons, isTTY, preview });
  if (problem) { log(`Email step not run: ${problem}.`); return 1; }
  const emailCfg = config.email || {};
  const from = emailCfg.smtp.from;
  const maxPerRun = Math.max(1, Number(emailCfg.maxPerRun) || 100);
  const plan = buildEmailPlan({ targets, brokers, persons, state, from, maxPerRun });

  for (const n of plan.notes) log(`  note: ${n}`);
  for (const m of plan.manual) log(`  manual ${m.name}: email to ${m.to} failed or bounced - check the address and send by hand`);

  // Interrupted sends from an earlier run: ask, never guess.
  const resend = [];
  if (!preview) {
    for (const u of plan.unknown) {
      const a = String(await ask(`  ${u.name} (${u.to}) may or may not have been sent last time. Resend? [y/N] `)).trim().toLowerCase();
      if (a === 'y' || a === 'yes') resend.push(u);
      else markUnknownAsSent(state, u);
    }
    if (plan.unknown.length) save();
  }
  // Resends count toward the cap like any other send, and go first.
  plan.items = [...resend, ...plan.items].slice(0, maxPerRun);

  if (!plan.items.length) { log('No email requests pending.'); return 0; }
  return confirmAndSend(plan.items, deps);
}

function findEmailTarget(names, query) {
  const q = lower(query);
  const exact = names.filter(n => lower(n) === q);
  if (exact.length === 1) return { name: exact[0] };
  const hits = names.filter(n => lower(n).includes(q));
  if (hits.length === 1) return { name: hits[0] };
  if (!hits.length) return { error: `No email broker matches "${query}".` };
  return { error: `"${query}" matches more than one email broker: ${hits.join(', ')}. Use the full name.` };
}

module.exports = { checkEmailSetup, buildEmailPlan, sendEmailPlan, classifySmtpError, markUnknownAsSent, recordReply, REPLY_OUTCOMES, confirmAndSend, runEmailStep, findEmailTarget, emailStatus };
