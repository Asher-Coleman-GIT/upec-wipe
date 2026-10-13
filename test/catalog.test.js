// test/catalog.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateRecord, loadCatalog, catalogBrokersForPerson, catalogSummary } = require('../lib/catalog');

const base = (over = {}) => ({
  domain: 'example-people.com', name: 'Example People', sources: ['markup'], group: 'people-search',
  survey: { controls: [{ tag: 'select', options: ['subject=The subject', 'agent=An agent'] }] },
  review: { state: 'reviewed', reviewedAt: '2026-10-13', note: 'ok', definition: {
    method: 'direct-form', optOutUrl: 'https://www.example-people.com/opt-out',
    formFields: { '#first': '{firstName}', '#last': '{lastName}', '#email': '{email}', '#agree': 'on', '#who': 'subject' },
    submitSelector: 'form button:has-text("Remove")', captchaLikely: true, requires: [],
  } },
  ...over,
});
const withDef = (d) => { const r = base(); r.review.definition = { ...r.review.definition, ...d }; return r; };
const PERSON = { firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', email: 'alias@relay.example', city: 'Austin', state: 'TX', zip: '73301', country: 'US' };

test('a well-formed reviewed record is valid', () => {
  assert.equal(validateRecord(base(), 'example-people.com.json'), null);
});

test('validation rules each reject a bad record', () => {
  const cases = [
    [base({ domain: 'other.com' }), /file name/],
    [base({ group: 'weird' }), /group/],
    [base({ review: { state: 'maybe' } }), /review state/],
    [withDef({ optOutUrl: 'http://www.example-people.com/opt-out' }), /not https/],
    [withDef({ optOutUrl: 'https://evil.com/opt-out' }), /not on example-people.com/],
    [withDef({ formFields: { '#agree': 'on' } }), /none of name or email/],
    [withDef({ formFields: { '#first': '{firstNmae}' } }), /unknown token/],
    [withDef({ method: 'search-form', searchUrl: 'https://example-people.com/s?q={fullName}', listingPattern: '(' }), /listingPattern/],
    [withDef({ formFields: { '#first': '{firstName}', '#m': '{dobMonthName}' } }), /require dob/],
    [base({ review: { state: 'manual', notes: 'x' } }), /https optOutUrl/],
  ];
  for (const [rec, re] of cases) assert.match(String(validateRecord(rec, 'example-people.com.json')), re);
});

test('literal personal value is rejected', () => {
  const err = validateRecord(withDef({ formFields: { '#first': 'Jane', '#email': '{email}' } }), 'example-people.com.json');
  assert.match(err, /literal value for #first is not allowed/);
});

test('a recorded select option value and "on" are allowed literals', () => {
  assert.equal(validateRecord(withDef({ formFields: { '#email': '{email}', '#who': 'agent', '#x': 'on' } }), 'example-people.com.json'), null);
});

test('loadCatalog skips invalid files with a warning and ignores candidates.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-cat-'));
  fs.writeFileSync(path.join(dir, 'example-people.com.json'), JSON.stringify(base()));
  fs.writeFileSync(path.join(dir, 'broken.com.json'), '{ "domain": "broken.com", ');
  fs.writeFileSync(path.join(dir, 'candidates.json'), '[]');
  const warnings = [];
  const recs = loadCatalog(dir, (m) => warnings.push(m));
  assert.deepEqual(recs.map(r => r.domain), ['example-people.com']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /broken\.com\.json skipped: not valid JSON/);
});

test('invalid JSON is skipped with a warning, a missing directory gives no records and no warning', () => {
  const warnings = [];
  assert.deepEqual(loadCatalog(path.join(os.tmpdir(), 'upec-wipe-no-such-dir'), (m) => warnings.push(m)), []);
  assert.equal(warnings.length, 0);
});

test('a reviewed record becomes a broker with values filled in', () => {
  const [b] = catalogBrokersForPerson([base()], PERSON);
  assert.equal(b.name, 'Example People');
  assert.equal(b.source, 'catalog');
  assert.equal(b.method, 'direct-form');
  assert.deepEqual(b.formFields, { '#first': 'Jane', '#last': 'Doe', '#email': 'alias@relay.example', '#agree': 'on', '#who': 'subject' });
  assert.equal(b.captchaLikely, true);
  assert.equal(b.usOnly, true);
});

test('search urls are url-encoded and listing patterns compiled', () => {
  const [b] = catalogBrokersForPerson([withDef({ method: 'search-form', searchUrl: 'https://example-people.com/s?q={fullName}&st={state}', listingPattern: 'example-people\\.com/p/' })], PERSON);
  assert.equal(b.searchUrl, 'https://example-people.com/s?q=Jane%20Doe&st=TX');
  assert.ok(b.listingPattern instanceof RegExp);
  assert.ok(b.listingPattern.test('https://example-people.com/p/123'));
});

test('state name, birth date tokens and missing person values resolve', () => {
  const rec = withDef({ requires: ['dob'], formFields: { '#email': '{email}', '#st': '{stateName}', '#m': '{dobMonthName}', '#d': '{dobDay}', '#y': '{dobYear}', '#zip': '{zip}' } });
  const [b] = catalogBrokersForPerson([rec], { ...PERSON, dob: '1990-04-07' });
  assert.equal(b.formFields['#st'], 'Texas');
  assert.deepEqual([b.formFields['#m'], b.formFields['#d'], b.formFields['#y']], ['April', '7', '1990']);
  assert.deepEqual(b.requires, ['dob']);
});

test('missing person values resolve to empty strings', () => {
  const rec = withDef({ requires: ['dob'], formFields: { '#email': '{email}', '#zip': '{zip}', '#y': '{dobYear}' } });
  const [b] = catalogBrokersForPerson([rec], { firstName: 'Jane', email: 'a@b.example' });
  assert.equal(b.formFields['#zip'], '');
  assert.equal(b.formFields['#y'], '');
});

test('manual and needs-review records become manual brokers with the link', () => {
  const manual = base({ domain: 'm.com', review: { state: 'manual', optOutUrl: 'https://m.com/privacy', notes: 'Send the request form' } });
  const drift = base({ domain: 'example-people.com' });
  drift.review.state = 'needs-review'; drift.review.note = 'form fields changed';
  const out = catalogBrokersForPerson([manual, drift], PERSON);
  assert.equal(out[0].method, 'manual');
  assert.equal(out[0].notes, 'Send the request form: https://m.com/privacy');
  assert.equal(out[1].method, 'manual');
  assert.match(out[1].notes, /needs review \(form fields changed\) - do it by hand: https:\/\/www\.example-people\.com\/opt-out/);
});

test('unreviewed and excluded records do nothing at run time', () => {
  const a = base({ domain: 'a.com', review: { state: 'unreviewed' } });
  const b = base({ domain: 'b.com', review: { state: 'excluded' } });
  assert.deepEqual(catalogBrokersForPerson([a, b], PERSON), []);
});

test('subdomain of an explicit host is dropped; a name clash is renamed (final review #6)', () => {
  const recs = [base({ domain: 'searchquarry.com' }), base({ domain: 'x.com', name: 'Spokeo' })];
  recs[1].review.definition.optOutUrl = 'https://x.com/opt-out';
  const out = catalogBrokersForPerson(recs, PERSON, { explicitHosts: new Set(['members.searchquarry.com']), explicitNames: new Set(['spokeo']) });
  assert.deepEqual(out.map(b => b.name), ['Spokeo (x.com)']);
});

test('catalogSummary lists every record', () => {
  const recs = [base(), base({ domain: 'm.com', review: { state: 'manual', optOutUrl: 'https://m.com/p' } })];
  assert.deepEqual(catalogSummary(recs).map(s => [s.name, s.state, s.optOutUrl]), [
    ['Example People', 'reviewed', 'https://www.example-people.com/opt-out'],
    ['Example People', 'manual', 'https://m.com/p'],
  ]);
});
