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

module.exports = { genericRetiredMessage, buildSubmissionPlan };
