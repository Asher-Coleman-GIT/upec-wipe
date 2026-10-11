'use strict';
/**
 * lib/catalog-drift.js
 *
 * A reviewed catalog site whose page changed must not be filled blind (the
 * TruePeopleSearch and DataAxle lessons of 2026-10-11). detectDrift compares a
 * fresh survey with the record; applyDrift parks the record as needs-review,
 * which runs as manual until it is reviewed again.
 */
const { hostnameOf } = require('./serp-scan');

// Selectors the survey can check: plain #id and [name="..."] forms.
function selectorPresent(sel, controls) {
  const id = /^#([\w-]+)$/.exec(sel);
  if (id) return controls.some(c => c.id === id[1]);
  const name = /\[name="([^"]+)"\]/.exec(sel);
  if (name && !/[,:]/.test(sel)) return controls.some(c => c.name === name[1]);
  return true; // scoped or text selectors are covered by the fingerprint
}

function detectDrift(record, survey) {
  const rv = record && record.review;
  if (!rv || rv.state !== 'reviewed' || !survey) return null;
  if (survey.error) return `opt-out page did not load (${String(survey.error).slice(0, 60)})`;
  if (survey.status === 404 || survey.status === 410) return `opt-out page gone (HTTP ${survey.status})`;
  if (survey.block) return `opt-out page is now blocked (${survey.block})`;
  const want = new URL(rv.definition.optOutUrl);
  if (survey.optOutUrl) {
    const got = new URL(survey.optOutUrl);
    const gotHost = hostnameOf(survey.optOutUrl);
    if (!(gotHost === record.domain || gotHost.endsWith(`.${record.domain}`))) return `opt-out page moved to ${gotHost}`;
    if (got.pathname.replace(/\/$/, '') !== want.pathname.replace(/\/$/, '')) return `opt-out page moved to ${got.pathname}`;
  }
  for (const sel of Object.keys(rv.definition.formFields || {})) {
    if (!selectorPresent(sel, survey.controls || [])) return `${sel} no longer on the page`;
  }
  if (record.survey && record.survey.fingerprint && survey.fingerprint && record.survey.fingerprint !== survey.fingerprint) return 'form fields changed';
  return null;
}

function applyDrift(record, reason, today) {
  return { ...record, review: { ...record.review, state: 'needs-review', note: `${reason} (found ${today})` } };
}

module.exports = { detectDrift, applyDrift };
