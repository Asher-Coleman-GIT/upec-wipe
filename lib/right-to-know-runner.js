'use strict';
/**
 * lib/right-to-know-runner.js
 *
 * Right-to-know (data access) requests by email. They use the same checks and
 * sender as the --email step (lib/email-step.js): the dedicated mailbox, no
 * network.proxy, an interactive SEND, the egress re-check before every send,
 * pacing, the per-run cap, and a record before and after each send, so a
 * broker never gets the same request twice for the same person.
 *
 * Keys are "know:" + stateKey in state.emailSent, apart from opt-out emails.
 */
const { stateKey, recordKnowRequest } = require('./config');
const { buildKnowRequest } = require('./right-to-know');
const { checkEmailSetup, confirmAndSend } = require('./email-step');

const KNOW_PREFIX = 'know:';

function buildKnowPlan({ brokers, persons, state, submissionEmailFor, blockedPersons, maxPerRun, manual }) {
  const sent = (state && state.emailSent) || {};
  const optOuts = (state && state.optOuts) || {};
  const failures = (state && state.emailFailures) || {};
  const replies = (state && state.emailReplies) || {};
  const addressesByPerson = new Map();
  const items = [];
  for (const broker of (brokers || []).filter(b => b.method === 'email' && b.emailTo)) {
    const to = String(broker.emailTo).trim().toLowerCase();
    for (const person of persons || []) {
      if (blockedPersons && blockedPersons.has(person)) continue;
      // No resolved address: fail closed, never the real email.
      const address = submissionEmailFor(person);
      if (!address) continue;
      // One request per broker address per person, like the --email step.
      const seen = addressesByPerson.get(person) || new Set();
      addressesByPerson.set(person, seen);
      if (seen.has(to)) continue;
      seen.add(to);
      const sk = stateKey(broker.name, person, persons.length);
      const key = KNOW_PREFIX + sk;
      if (sent[key]) continue;
      // Recorded by the old sender (SMTP or printed template): already asked.
      if (optOuts[sk] && optOuts[sk].knowRequestedAt) continue;
      // Two failed sends or a logged bounce: a person has to check the address.
      if ((failures[key] || 0) >= 2 || (replies[key] && replies[key].outcome === 'bounced')) {
        if (manual) manual.push({ name: broker.name, to });
        continue;
      }
      const { subject, body } = buildKnowRequest({ person: { ...person, email: address }, broker });
      items.push({ key, name: broker.name, to, basis: null, subject, body, person });
    }
  }
  return items.slice(0, maxPerRun);
}

async function runKnowStep(deps) {
  const { config, persons, isTTY, preview, log } = deps;
  log('\n-- Right-to-know requests ----------------------------------');
  // An interrupted send is never retried: the broker may already have it.
  for (const [key, rec] of Object.entries((deps.state && deps.state.emailSent) || {})) {
    if (!key.startsWith(KNOW_PREFIX) || !rec || rec.status !== 'unknown') continue;
    const name = key.slice(KNOW_PREFIX.length).split('|')[0];
    log(`  note: ${name} right-to-know request may or may not have been sent last time; it is not sent again. Check the dedicated mailbox's Sent folder.`);
  }
  const problem = checkEmailSetup({ config, persons, isTTY, preview });
  if (problem) { log(`Right-to-know not sent: ${problem}.`); return 1; }
  const maxPerRun = Math.max(1, Number(config.email.maxPerRun) || 100);
  const manual = [];
  const items = buildKnowPlan({ ...deps, maxPerRun, manual });
  for (const m of manual) log(`  manual ${m.name}: right-to-know email to ${m.to} failed or bounced - check the address and send by hand`);
  if (!items.length) { log('No right-to-know requests pending.'); return 0; }
  const recordKnow = deps.recordKnow || recordKnowRequest;
  return confirmAndSend(items, {
    ...deps,
    label: 'right-to-know request(s)',
    rerun: 'upec-wipe know',
    // --know-status reads knowRequestedAt to flag requests past 45 days.
    onSent: (it) => recordKnow(it.name, it.person, persons.length),
  });
}

module.exports = { runKnowStep, buildKnowPlan, KNOW_PREFIX };
