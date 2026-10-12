'use strict';
/**
 * lib/modes/know.js - --know: right-to-know requests by email (moved from watcher.js).
 */
const { STATE_PATH, saveState, getPendingKnowRequests } = require('../config');
const lock = require('../lock');
const { EgressError } = require('../egress');
const { buildSubmissionPlan, submissionOptions } = require('../submission-plan');
const { checkEmailSetup } = require('../email-step');
const { runKnowStep } = require('../right-to-know-runner');
const { PREVIEW_ALIAS_NOTE, acquireStateLockOrExit, emailStepIo, loadRunSetup } = require('./shared');

// The --know flow after setup. deps are injectable so the order of the checks
// can be tested without a mailbox, SimpleLogin or a terminal.
async function knowFlow({ config, persons, state, brokers, preview }, deps = {}) {
  const d = {
    checkEmailSetup, buildSubmissionPlan, runKnowStep, saveState, getPendingKnowRequests,
    io: emailStepIo,
    isTTY: () => !!process.stdin.isTTY,
    log: (l) => console.log(l),
    error: (l) => console.error(l),
    ...deps,
  };
  // Check the mailbox setup first: a run that will be refused must not
  // create a SimpleLogin alias.
  const setupProblem = d.checkEmailSetup({ config, persons, isTTY: d.isTTY(), preview });
  if (setupProblem) {
    d.log(`Right-to-know not sent: ${setupProblem}.`);
    return 1;
  }
  const plan = await d.buildSubmissionPlan({ config, persons, state, preview });
  for (const b of plan.blocked) {
    d.error(`Skipping person #${persons.indexOf(b.person) + 1}: ${b.reason}`);
  }
  if (plan.allowed.some(a => a.placeholder)) d.log(PREVIEW_ALIAS_NOTE);
  const code = await d.runKnowStep({
    config, persons, state, save: d.saveState, brokers, preview,
    ...submissionOptions(plan), ...d.io(),
  });
  // Keeps an alias minted by buildSubmissionPlan even when nothing was sent.
  d.saveState();
  const pending = d.getPendingKnowRequests(brokers, { olderThanDays: 45 });
  d.log(`\n${pending.length} earlier request(s) are past 45 days (run --know-status for detail).\n`);
  return code;
}

async function run({ flags }) {
  const { config, state, persons } = loadRunSetup(flags);
  const brokers = require('../../brokers');
  const KNOW_LOCK_PATH = STATE_PATH + '.lock';
  acquireStateLockOrExit();
  try {
    const code = await knowFlow({ config, persons, state, brokers, preview: flags.DRY_RUN });
    lock.release(KNOW_LOCK_PATH);
    return code;
  } catch (err) {
    // Keep an alias minted before the throw.
    try { saveState(); } catch (saveErr) { console.error('could not save state:', saveErr.message); }
    lock.release(KNOW_LOCK_PATH);
    if (err instanceof EgressError) console.error(err.message);
    else console.error('know error:', err.message);
    return 1;
  }
}

module.exports = { run, knowFlow };
