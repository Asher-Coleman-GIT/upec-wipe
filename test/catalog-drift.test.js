// test/catalog-drift.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectDrift, applyDrift, checkProblem } = require('../lib/catalog-drift');

const controls = [{ tag: 'input', type: 'text', id: 'first', name: 'first', placeholder: '' }, { tag: 'input', type: 'email', id: 'email', name: 'email', placeholder: '' }];
const rec = () => ({ domain: 'acme.com', name: 'Acme', group: 'people-search',
  survey: { fingerprint: 'F1', optOutUrl: 'https://acme.com/optout' },
  review: { state: 'reviewed', reviewedAt: '2026-10-13', definition: { method: 'direct-form', optOutUrl: 'https://acme.com/optout', formFields: { '#first': '{firstName}', '#email': '{email}' } } } });
const fresh = (o = {}) => ({ status: 200, block: null, optOutUrl: 'https://acme.com/optout', controls, fingerprint: 'F1', ...o });

test('an unchanged page is not drift', () => { assert.equal(detectDrift(rec(), fresh()), null); });
test('only reviewed records drift', () => { const r = rec(); r.review.state = 'manual'; assert.equal(detectDrift(r, fresh({ status: 404 })), null); });
test('a dead page is drift', () => { assert.match(detectDrift(rec(), fresh({ status: 404 })), /page gone \(HTTP 404\)/); });
// 2026-10-15: a page that did not load, or a bot check, says nothing about the
// form. Parking a working site on it made it manual until re-reviewed; a run
// that cannot load the page cannot fill it blind either.
test('an error is not drift, it is "could not be checked"', () => {
  const s = fresh({ error: 'net::ERR_NAME_NOT_RESOLVED' });
  assert.equal(detectDrift(rec(), s), null);
  assert.match(checkProblem(s), /did not load/);
});
test('a block page is not drift, it is "could not be checked"', () => {
  const s = fresh({ block: 'hard' });
  assert.equal(detectDrift(rec(), s), null);
  assert.match(checkProblem(s), /blocked/);
});
test('a page that loaded is checkable', () => { assert.equal(checkProblem(fresh()), null); });

// 2026-10-15, We Inform and its 3 sister sites: the name, city and email fields
// stay hidden until the removal option is checked, and the survey lists
// visible controls only. Every catalog-check parked all 4 working sites.
test('a field present in the page but hidden is not drift', () => {
  const s = fresh({ controls: [controls[1]], present: { '#first': true, '#email': true } });
  assert.equal(detectDrift(rec(), s), null);
});
test('a field absent from the page is drift', () => {
  const s = fresh({ controls: [controls[1]], present: { '#first': false, '#email': true } });
  assert.match(detectDrift(rec(), s), /#first no longer on the page/);
});
test('fingerprints are compared only for the same page', () => {
  const r = rec(); r.survey.optOutUrl = 'https://acme.com/landing';
  assert.equal(detectDrift(r, fresh({ fingerprint: 'F2' })), null);
});
test('off-domain opt-out page is drift', () => { assert.match(detectDrift(rec(), fresh({ optOutUrl: 'https://other.com/optout' })), /moved to other\.com/); });
test('a moved path is drift', () => { assert.match(detectDrift(rec(), fresh({ optOutUrl: 'https://acme.com/privacy' })), /moved to \/privacy/); });
test('a missing selector is drift', () => { assert.match(detectDrift(rec(), fresh({ controls: [controls[1]], fingerprint: 'F2' })), /#first no longer on the page/); });
test('a changed form fingerprint alone is drift', () => { assert.match(detectDrift(rec(), fresh({ fingerprint: 'F2' })), /form fields changed/); });

test('applyDrift marks needs-review and keeps the definition', () => {
  const r = applyDrift(rec(), 'form fields changed', '2026-11-01');
  assert.equal(r.review.state, 'needs-review');
  assert.equal(r.review.note, 'form fields changed (found 2026-11-01)');
  assert.ok(r.review.definition);
});
