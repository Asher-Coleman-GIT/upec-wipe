/**
 * lib/submission-plan.js
 *
 * Fork policy helpers used by watcher.js.
 *
 * - genericRetiredMessage: the generic pass was retired. A config that still
 *   turns it on is refused with this text rather than quietly ignored.
 * - buildSubmissionPlan: resolve each person's submission email once, before any
 *   browser work. A person whose relay alias is unavailable is blocked for the
 *   whole run on every channel; other people still run.
 */

'use strict';

const { getSubmissionEmail, RelayUnavailableError, PREVIEW_ALIAS } = require('./relay');

const GENERIC_RETIRED = 'The generic pass was retired: remove the "generic" block from config.json. Its sites are in the reviewed catalog (data/catalog/).';

// Only enabled === true ever turned the pass on, so only that is refused.
function genericRetiredMessage(config) {
  return config && config.generic && config.generic.enabled === true ? GENERIC_RETIRED : null;
}

// preview: true (dry-run/preview) never calls the alias API; a person with no
// cached alias gets PREVIEW_ALIAS and placeholder: true.
async function buildSubmissionPlan({ config, persons, state, createImpl, preview }) {
  const allowed = [];
  const blocked = [];
  for (const person of persons) {
    try {
      const email = await getSubmissionEmail({ config, person, state, createImpl, preview: !!preview });
      allowed.push({ person, email, masked: email !== person.email, placeholder: email === PREVIEW_ALIAS });
    } catch (err) {
      if (!(err instanceof RelayUnavailableError)) throw err;
      blocked.push({ person, reason: err.message });
    }
  }
  return { allowed, blocked };
}

/**
 * Options for the email senders (the --know step) built from
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

module.exports = { genericRetiredMessage, buildSubmissionPlan, submissionOptions, withSubmissionEmail };
