/**
 * lib/submission-plan.js
 *
 * Fork policy helpers used by watcher.js.
 *
 * - isGenericEnabled: the ~490-site heuristic generic pass is opt-in. It submits
 *   name, email, state and zip to sites chosen from public datasets, with no
 *   per-site review, so it stays off unless asked for.
 * - buildSubmissionPlan: resolve each person's submission email once, before any
 *   browser work. A person whose relay alias is unavailable is blocked for the
 *   whole run on every channel; other people still run.
 */

'use strict';

const { getSubmissionEmail, RelayUnavailableError } = require('./relay');

function isGenericEnabled(argv, config) {
  if (Array.isArray(argv) && argv.includes('--generic')) return true;
  return !!(config && config.generic && config.generic.enabled === true);
}

async function buildSubmissionPlan({ config, persons, state, createImpl }) {
  const allowed = [];
  const blocked = [];
  for (const person of persons) {
    try {
      const email = await getSubmissionEmail({ config, person, state, createImpl });
      allowed.push({ person, email, masked: email !== person.email });
    } catch (err) {
      if (!(err instanceof RelayUnavailableError)) throw err;
      blocked.push({ person, reason: err.message });
    }
  }
  return { allowed, blocked };
}

/**
 * Options for the email senders (sendOptOutEmails, sendKnowRequests) built from
 * a plan: the alias resolver for allowed persons and the blocked set. Call the
 * sender once per run with these, never once per person.
 */
function submissionOptions(plan) {
  const aliasFor = new Map(plan.allowed.map(a => [a.person, a.email]));
  return {
    submissionEmailFor: (p) => aliasFor.get(p),
    blockedPersons: new Set(plan.blocked.map(b => b.person)),
  };
}

function withSubmissionEmail(person, email) {
  if (!email || email === person.email) return person;
  return { ...person, email };
}

module.exports = { isGenericEnabled, buildSubmissionPlan, submissionOptions, withSubmissionEmail };
