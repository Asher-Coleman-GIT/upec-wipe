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

function buildKnowPlan({ brokers, persons, state, submissionEmailFor, blockedPersons, maxPerRun }) {
  const sent = (state && state.emailSent) || {};
  const items = [];
  for (const broker of (brokers || []).filter(b => b.method === 'email' && b.emailTo)) {
    for (const person of persons || []) {
      if (blockedPersons && blockedPersons.has(person)) continue;
      // No resolved address: fail closed, never the real email.
      const address = submissionEmailFor(person);
      if (!address) continue;
      const key = KNOW_PREFIX + stateKey(broker.name, person, persons.length);
      if (sent[key]) continue;
      const { subject, body } = buildKnowRequest({ person: { ...person, email: address }, broker });
      items.push({ key, name: broker.name, to: String(broker.emailTo).trim().toLowerCase(), basis: null, subject, body, person });
    }
  }
  return items.slice(0, maxPerRun);
}

async function runKnowStep(deps) {
  const { config, persons, isTTY, preview, log } = deps;
  log('\n-- Right-to-know requests ----------------------------------');
  const problem = checkEmailSetup({ config, persons, isTTY, preview });
  if (problem) { log(`Right-to-know not sent: ${problem}.`); return 1; }
  const maxPerRun = Math.max(1, Number(config.email.maxPerRun) || 100);
  const items = buildKnowPlan({ ...deps, maxPerRun });
  if (!items.length) { log('No right-to-know requests pending.'); return 0; }
  const recordKnow = deps.recordKnow || recordKnowRequest;
  return confirmAndSend(items, {
    ...deps,
    label: 'right-to-know request(s)',
    rerun: '--know',
    // --know-status reads knowRequestedAt to flag requests past 45 days.
    onSent: (it) => recordKnow(it.name, it.person, persons.length),
  });
}

module.exports = { runKnowStep, buildKnowPlan, KNOW_PREFIX };
