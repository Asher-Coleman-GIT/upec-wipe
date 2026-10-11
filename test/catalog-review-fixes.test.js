/**
 * test/catalog-review-fixes.test.js
 *
 * Findings from the final review of the site-catalog branch (2026-10-12).
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateRecord, catalogBrokersForPerson } = require('../lib/catalog');
const { buildCandidates, feedRows } = require('../lib/catalog-sources');
const { normalizeFeedRow, dedupeFeedBrokers } = require('../lib/feeds');
const { detectDrift } = require('../lib/catalog-drift');

const rec = (def, over = {}) => ({
  domain: 'acme.com', name: 'Acme', group: 'people-search', survey: { controls: [] },
  review: { state: 'reviewed', reviewedAt: '2026-10-13', definition: { method: 'direct-form', optOutUrl: 'https://acme.com/optout', formFields: { '#e': '{email}' }, ...def } },
  ...over,
});
const ok = (r) => validateRecord(r, `${r.domain}.json`);

// #1 URLs
test('#1 a URL may not carry the email token', () => {
  assert.match(ok(rec({ optOutUrl: 'https://acme.com/o?e={email}' })), /email.*URL/i);
  assert.match(ok(rec({ method: 'search-form', searchUrl: 'https://acme.com/s?q={email}', listingPattern: 'acme' })), /email.*URL/i);
});
test('#1 a personal query parameter must be a token', () => {
  assert.match(ok(rec({ optOutUrl: 'https://acme.com/o?first=Janet' })), /query parameter "first"/);
  assert.equal(ok(rec({ method: 'search-form', searchUrl: 'https://acme.com/s?first={firstName}&type=pp', listingPattern: 'acme' })), null);
});

// #2 manual / manualAfterSearch formFields
test('#2 formFields are checked whatever the method', () => {
  assert.match(ok(rec({ method: 'search-form', searchUrl: 'https://acme.com/s?q={fullName}', listingPattern: 'acme', manualAfterSearch: true, formFields: { '#f': 'Jane Roe' } })), /literal value for #f/);
  assert.match(ok(rec({ method: 'manual', formFields: { '#z': '90210' } })), /literal value for #z/);
});

// #3 bare domains, manual URLs off-domain
test('#3 a bare or public-suffix domain is rejected', () => {
  assert.match(ok(rec({ optOutUrl: 'https://evil.com/o' }, { domain: 'com' })), /domain/);
  assert.match(ok(rec({ optOutUrl: 'https://x.co.uk/o' }, { domain: 'co.uk' })), /domain/);
});
test('#3 manual and needs-review URLs must be on the domain', () => {
  assert.match(ok({ domain: 'acme.com', name: 'A', group: 'people-search', review: { state: 'manual', optOutUrl: 'https://evil.com/p' } }), /not on acme\.com/);
  const nr = rec({ optOutUrl: 'https://evil.com/o' }); nr.review.state = 'needs-review';
  assert.match(ok(nr), /not on acme\.com/);
});

// #4 platform-hosted privacy pages
test('#4 registry rows keep the broker website', () => {
  const e = normalizeFeedRow({ 'data broker name': 'Acme', 'data broker primary website': 'www.acme.com', "data broker's primary website that contains details on how consumers can exercise their ca consumer privacy rights": 'https://privacyportal.onetrust.com/webform/a/b' }, 'ca');
  assert.equal(e.website, 'https://www.acme.com');
  assert.equal(e.optOutUrl, 'https://privacyportal.onetrust.com/webform/a/b');
});
test('#4 feed dedupe keys on the broker website, not the shared privacy host', () => {
  const rows = [
    { name: 'A', optOutUrl: 'https://privacyportal.onetrust.com/webform/1', website: 'https://a.com', source: 'ca' },
    { name: 'B', optOutUrl: 'https://privacyportal.onetrust.com/webform/2', website: 'https://b.com', source: 'ca' },
  ];
  assert.deepEqual(dedupeFeedBrokers(rows, []).map(r => r.name), ['A', 'B']);
});
test('#4 candidates are keyed by the broker website and record the form host', () => {
  const f = require('fs'); const p = require('path').join(require('os').tmpdir(), `aidr-feed-${process.pid}.json`);
  f.writeFileSync(p, JSON.stringify([
    { name: 'A', optOutUrl: 'https://privacyportal.onetrust.com/webform/1', website: 'https://www.a.com', source: 'ca' },
    { name: 'B', optOutUrl: 'https://privacyportal.onetrust.com/webform/2', website: 'https://b.com', source: 'ca' },
  ]));
  const c = buildCandidates({ rows: feedRows(p) });
  assert.deepEqual(c.map(x => [x.domain, x.formHosts]), [['a.com', ['onetrust.com']], ['b.com', ['onetrust.com']]]);
});
test('#4 a definition may use the recorded form host, and no other', () => {
  const r = rec({ optOutUrl: 'https://privacyportal.onetrust.com/webform/1' }, { formHosts: ['onetrust.com'] });
  assert.equal(ok(r), null);
  assert.match(ok(rec({ optOutUrl: 'https://privacyportal.onetrust.com/webform/1' })), /not on acme\.com/);
});
test('#4 drift accepts the form host', () => {
  const r = rec({ optOutUrl: 'https://privacyportal.onetrust.com/webform/1' }, { formHosts: ['onetrust.com'] });
  assert.equal(detectDrift(r, { status: 200, optOutUrl: 'https://privacyportal.onetrust.com/webform/1', controls: [{ tag: 'input', type: 'email', id: 'e', name: 'e', placeholder: '' }] }), null);
});

// #5 / #6 names
const P = { firstName: 'Jane', email: 'a@relay.example', country: 'US' };
test('#5 catalog display names drop legal suffixes and commas', () => {
  const [b] = catalogBrokersForPerson([rec({}, { name: '33Across, Inc.' })], P);
  assert.equal(b.name, '33Across');
});
test('#6 repeated display names get the domain added', () => {
  const out = catalogBrokersForPerson([rec({}, { name: 'The Alesco Group LLC' }), rec({ optOutUrl: 'https://mydataprivacy.com/o' }, { domain: 'mydataprivacy.com', name: 'The Alesco Group, LLC' })], P);
  assert.deepEqual(out.map(b => b.name), ['The Alesco Group (acme.com)', 'The Alesco Group (mydataprivacy.com)']);
});
test('#6 a display name that clashes with an explicit broker is renamed, not dropped', () => {
  const out = catalogBrokersForPerson([rec({}, { name: 'Spokeo, Inc.' })], P, { explicitNames: new Set(['spokeo']) });
  assert.deepEqual(out.map(b => b.name), ['Spokeo (acme.com)']);
  assert.ok(out[0].formHosts !== undefined);
});

test('#4 the survey copies the candidate form hosts into the record', () => {
  const { mergeSurvey } = require('../lib/catalog-survey-core');
  const r = mergeSurvey(null, { domain: 'a.com', name: 'A', sources: ['ca-registry'], urls: ['https://privacyportal.onetrust.com/w/1'], contacts: [], formHosts: ['onetrust.com'] }, { group: 'business' });
  assert.deepEqual(r.formHosts, ['onetrust.com']);
});
