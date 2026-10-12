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

module.exports = { checkEmailSetup, buildEmailPlan, sendEmailPlan, classifySmtpError, markUnknownAsSent, recordReply, REPLY_OUTCOMES };
