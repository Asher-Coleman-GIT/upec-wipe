// test/catalog-drift.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectDrift, applyDrift } = require('../lib/catalog-drift');

const controls = [{ tag: 'input', type: 'text', id: 'first', name: 'first', placeholder: '' }, { tag: 'input', type: 'email', id: 'email', name: 'email', placeholder: '' }];
const rec = () => ({ domain: 'acme.com', name: 'Acme', group: 'people-search',
  survey: { fingerprint: 'F1', optOutUrl: 'https://acme.com/optout' },
  review: { state: 'reviewed', reviewedAt: '2026-10-13', definition: { method: 'direct-form', optOutUrl: 'https://acme.com/optout', formFields: { '#first': '{firstName}', '#email': '{email}' } } } });
const fresh = (o = {}) => ({ status: 200, block: null, optOutUrl: 'https://acme.com/optout', controls, fingerprint: 'F1', ...o });

test('an unchanged page is not drift', () => { assert.equal(detectDrift(rec(), fresh()), null); });
test('only reviewed records drift', () => { const r = rec(); r.review.state = 'manual'; assert.equal(detectDrift(r, fresh({ status: 404 })), null); });
test('a dead page is drift', () => { assert.match(detectDrift(rec(), fresh({ status: 404 })), /page gone \(HTTP 404\)/); });
test('an error is drift', () => { assert.match(detectDrift(rec(), fresh({ error: 'net::ERR_NAME_NOT_RESOLVED' })), /did not load/); });
test('a new block page is drift', () => { assert.match(detectDrift(rec(), fresh({ block: 'hard' })), /now blocked/); });
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
