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
  const plan = { items: [], unknown: [], manual: [] };
  for (const person of persons || []) {
    const { subject, body } = buildUcpaRequest(person, from);
    for (const t of all) {
      const key = stateKey(t.name, person, persons.length);
      const item = { key, name: t.name, to: t.to, basis: t.basis, subject, body };
      const s = sent[key];
      if (s && s.status === 'unknown') { plan.unknown.push(item); continue; }
      if (s) continue;
      if ((failures[key] || 0) >= 2 || (replies[key] && replies[key].outcome === 'bounced')) { plan.manual.push(item); continue; }
      plan.items.push(item);
    }
  }
  plan.items = plan.items.slice(0, maxPerRun);
  return plan;
}

function classifySmtpError(err) {
  const code = err && err.responseCode;
  const msg = String((err && err.message) || '');
  if ((err && err.code === 'EAUTH') || code === 534 || code === 535) return 'auth';
  if (code === 421 || code === 452 || /daily user sending limit|quota|rate limit|too many/i.test(msg)) return 'quota';
  return 'broker';
}

async function sendEmailPlan(items, { transport, from, paceMs = 45000, sleep, state, save, log = () => {}, now = () => new Date().toISOString() }) {
  state.emailSent = state.emailSent || {};
  state.emailFailures = state.emailFailures || {};
  const result = { sent: [], failed: [], stopped: null };
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (i > 0) await sleep(paceMs);
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
        log(`  stopped at ${it.name}: ${kind === 'auth' ? 'the mailbox refused the login' : 'the mailbox sending limit was reached'} (${code})`);
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
    result.sent.push(it);
    log(`  sent  ${it.name} -> ${it.to}`);
  }
  return result;
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

async function runEmailStep({ config, persons, state, save, targets, brokers, preview, isTTY, ask, log, makeTransport, ensureEgress, sleep }) {
  log('\n-- Email requests ------------------------------------------');
  const problem = checkEmailSetup({ config, persons, isTTY, preview });
  if (problem) { log(`Email step not run: ${problem}.`); return 1; }
  const emailCfg = config.email || {};
  const from = emailCfg.smtp.from;
  const paceMs = Math.max(1, Number(emailCfg.paceSeconds) || 45) * 1000;
  const maxPerRun = Math.max(1, Number(emailCfg.maxPerRun) || 100);
  const plan = buildEmailPlan({ targets, brokers, persons, state, from, maxPerRun });

  for (const m of plan.manual) log(`  manual ${m.name}: email to ${m.to} failed or bounced - check the address and send by hand`);

  // Interrupted sends from an earlier run: ask, never guess.
  if (!preview) {
    for (const u of plan.unknown) {
      const a = String(await ask(`  ${u.name} (${u.to}) may or may not have been sent last time. Resend? [y/N] `)).trim().toLowerCase();
      if (a === 'y' || a === 'yes') plan.items.push(u);
      else markUnknownAsSent(state, u);
    }
    if (plan.unknown.length) save();
  }

  if (!plan.items.length) { log('No email requests pending.'); return 0; }

  log(`${plan.items.length} email request(s) from ${from}:`);
  for (const it of plan.items) {
    log(`  ${it.name.padEnd(40)} ${it.to}`);
    if (it.basis) log(`      basis (${it.basis.kind}): "${it.basis.quote}"  ${it.basis.url}`);
  }
  log(`\nSubject: ${plan.items[0].subject}\n\n${plan.items[0].body}\n`);
  if (preview) {
    for (const it of plan.items.slice(1)) log(`--- ${it.name} ---\n${it.body}\n`);
    log('Preview: nothing sent.');
    return 0;
  }

  const minutes = Math.ceil(((plan.items.length - 1) * paceMs) / 60000);
  const answer = String(await ask(`Type SEND to send ${plan.items.length} email(s), one every ${paceMs / 1000}s (about ${minutes} min): `)).trim();
  if (answer !== 'SEND') { log('Not sent.'); return 1; }

  await ensureEgress(config);
  const result = await sendEmailPlan(plan.items, { transport: makeTransport(emailCfg.smtp), from, paceMs, sleep, state, save, log });
  log(`\nEmail requests: ${result.sent.length} sent, ${result.failed.length} not delivered.`);
  if (result.stopped === 'auth') log('Stopped: the mailbox refused the login. Check email.smtp.user and the app password (2-step verification must be on).');
  if (result.stopped === 'quota') log('Stopped: the mailbox hit its sending limit. Run --email again tomorrow; it carries on where it stopped.');
  return result.stopped ? 1 : 0;
}

module.exports = { checkEmailSetup, buildEmailPlan, sendEmailPlan, classifySmtpError, markUnknownAsSent, recordReply, REPLY_OUTCOMES, runEmailStep };
