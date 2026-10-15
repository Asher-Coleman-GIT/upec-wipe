'use strict';
/**
 * lib/catalog-drift.js
 *
 * A reviewed catalog site whose page changed must not be filled blind (the
 * TruePeopleSearch and DataAxle lessons of 2026-10-11). detectDrift compares a
 * fresh survey with the record; applyDrift parks the record as needs-review,
 * which runs as manual until it is reviewed again.
 *
 * checkProblem: a page that did not load or showed a block page says nothing
 * about the form, so it is "could not be checked", not drift (2026-10-15: a
 * parked site stays manual until re-reviewed, and a run that cannot load the
 * page cannot fill it blind either).
 */
const { hostnameOf, registrableDomain } = require('./domain');

// Selectors the survey can check: plain #id and [name="..."] forms. The
// survey's `present` map says whether each one exists in the page, hidden or
// not (We Inform shows its fields only once the removal option is checked);
// older surveys only have the visible controls.
function selectorPresent(sel, controls, present) {
  if (present && Object.prototype.hasOwnProperty.call(present, sel)) return present[sel] === true;
  const id = /^#([\w-]+)$/.exec(sel);
  if (id) return controls.some(c => c.id === id[1]);
  const name = /\[name="([^"]+)"\]/.exec(sel);
  if (name && !/[,:]/.test(sel)) return controls.some(c => c.name === name[1]);
  return true; // scoped or text selectors are covered by the fingerprint
}

function checkProblem(survey) {
  if (!survey) return 'not surveyed';
  if (survey.error) return `opt-out page did not load (${String(survey.error).slice(0, 60)})`;
  if (survey.block) return `opt-out page is blocked (${survey.block})`;
  return null;
}

const samePage = (a, b) => {
  try {
    const x = new URL(a), y = new URL(b);
    return x.hostname === y.hostname && x.pathname.replace(/\/$/, '') === y.pathname.replace(/\/$/, '');
  } catch (_) { return false; }
};

function detectDrift(record, survey) {
  const rv = record && record.review;
  if (!rv || rv.state !== 'reviewed' || !survey) return null;
  if (checkProblem(survey)) return null;
  if (survey.status === 404 || survey.status === 410) return `opt-out page gone (HTTP ${survey.status})`;
  const want = new URL(rv.definition.optOutUrl);
  if (survey.optOutUrl) {
    const got = new URL(survey.optOutUrl);
    const gotHost = hostnameOf(survey.optOutUrl);
    const formHost = Array.isArray(record.formHosts) && record.formHosts.includes(registrableDomain(gotHost));
    if (!(gotHost === record.domain || gotHost.endsWith(`.${record.domain}`) || formHost)) return `opt-out page moved to ${gotHost}`;
    if (got.pathname.replace(/\/$/, '') !== want.pathname.replace(/\/$/, '')) return `opt-out page moved to ${got.pathname}`;
  }
  for (const sel of Object.keys(rv.definition.formFields || {})) {
    if (!selectorPresent(sel, survey.controls || [], survey.present)) return `${sel} no longer on the page`;
  }
  // The visible-controls fingerprint means something only against the same page.
  const prev = record.survey;
  if (prev && prev.fingerprint && survey.fingerprint && prev.fingerprint !== survey.fingerprint &&
      samePage(prev.optOutUrl, survey.optOutUrl)) return 'form fields changed';
  return null;
}

function applyDrift(record, reason, today) {
  return { ...record, review: { ...record.review, state: 'needs-review', note: `${reason} (found ${today})` } };
}

module.exports = { detectDrift, applyDrift, checkProblem };
