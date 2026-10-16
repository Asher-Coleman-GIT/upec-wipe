// test/catalog-survey-core.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const core = require('../lib/catalog-survey-core');

const C = (o) => ({ tag: 'input', type: 'text', name: '', id: '', placeholder: '', aria: '', label: '', ...o });

test('identity fields are name or email inputs, not search boxes', () => {
  assert.equal(core.hasIdentityField([C({ id: 'first-name' })]), true);
  assert.equal(core.hasIdentityField([C({ type: 'email' })]), true);
  assert.equal(core.hasIdentityField([C({ placeholder: 'Search by name' })]), false);
  assert.equal(core.hasIdentityField([]), false);
});

test('groups', () => {
  assert.equal(core.classifyGroup({ error: 'net::ERR_NAME_NOT_RESOLVED at https://x' }), 'dead');
  assert.equal(core.classifyGroup({ status: 404 }), 'dead');
  assert.equal(core.classifyGroup({ status: 403, blocked: { reason: 'x', solvable: true } }), 'blocked');
  assert.equal(core.classifyGroup({ error: 'Timeout 25000ms exceeded' }), 'unknown');
  assert.equal(core.classifyGroup({ status: 200, title: 'Free People Search', text: '', controls: [] }), 'people-search');
  assert.equal(core.classifyGroup({ status: 200, title: 'Opt out', text: '', controls: [C({ placeholder: 'Search people by name' })] }), 'people-search');
  assert.equal(core.classifyGroup({ status: 200, title: 'Privacy Policy | Acme Ads', text: 'cookies', controls: [] }), 'business');
});

test('opt-out links: same site, https, opt-out words, at most 3, no repeats', () => {
  const links = [
    { text: 'Do Not Sell My Info', href: '/dns' },
    { text: 'Opt out', href: 'https://other.com/optout' },
    { text: 'Privacy Policy', href: '/privacy' },
    { text: 'Remove my record', href: 'https://help.acme.com/remove' },
    { text: 'Delete', href: '/delete#top' },
    { text: 'Opt-out', href: '/optout' },
    { text: 'again', href: '/dns' },
  ];
  assert.deepEqual(core.optOutLinks(links, 'https://www.acme.com/privacy', 'acme.com'), [
    'https://www.acme.com/dns', 'https://help.acme.com/remove', 'https://www.acme.com/delete',
  ]);
});

test('email contacts are the site\'s own mailto addresses', () => {
  const links = [{ text: 'privacy@acme.com', href: 'mailto:privacy@acme.com' }, { text: 'x', href: 'mailto:someone@gmail.com' }, { text: 'y', href: 'mailto:PRIVACY@acme.com?subject=x' }];
  assert.deepEqual(core.emailContacts(links, 'acme.com'), ['privacy@acme.com']);
});

test('fingerprint ignores order and changes when a field changes', () => {
  const a = [C({ id: 'first' }), C({ id: 'email', type: 'email' })];
  assert.equal(core.fingerprint(a), core.fingerprint([...a].reverse()));
  assert.notEqual(core.fingerprint(a), core.fingerprint([C({ id: 'fname' }), a[1]]));
});

test('mergeSurvey keeps the review, unions sources and sets the group', () => {
  const existing = { domain: 'acme.com', name: 'Acme', sources: ['markup'], group: 'unknown', review: { state: 'reviewed', note: 'x' } };
  const cand = { domain: 'acme.com', name: 'Acme Inc', sources: ['ca-registry'], urls: ['https://acme.com'], contacts: ['p@acme.com'] };
  const rec = core.mergeSurvey(existing, cand, { group: 'people-search', checkedAt: 't', contacts: ['privacy@acme.com'] });
  assert.equal(rec.name, 'Acme');
  assert.deepEqual(rec.sources, ['markup', 'ca-registry']);
  assert.equal(rec.group, 'people-search');
  assert.deepEqual(rec.review, { state: 'reviewed', note: 'x' });
  assert.deepEqual(rec.survey.contacts, ['p@acme.com', 'privacy@acme.com']);
  assert.equal('group' in rec.survey, false);
});

test('mergeSurvey for a new site starts unreviewed, and a group override wins', () => {
  const cand = { domain: 'n.com', name: 'N', sources: ['markup'], urls: ['https://n.com'], contacts: [] };
  assert.deepEqual(core.mergeSurvey(null, cand, { group: 'business' }).review, { state: 'unreviewed' });
  const over = core.mergeSurvey({ domain: 'n.com', name: 'N', sources: [], group: 'business', review: { state: 'unreviewed', groupOverride: 'people-search' } }, cand, { group: 'business' });
  assert.equal(over.group, 'people-search');
});

test('writeRecordAtomic writes the whole record and leaves no temp file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-cat-'));
  const p = core.writeRecordAtomic(dir, { domain: 'acme.com', name: 'Acme' });
  assert.equal(p, path.join(dir, 'acme.com.json'));
  assert.deepEqual(JSON.parse(fs.readFileSync(p, 'utf8')), { domain: 'acme.com', name: 'Acme' });
  assert.deepEqual(fs.readdirSync(dir), ['acme.com.json']);
});

test('mergeSurvey keeps email addresses out of everything but contacts', () => {
  const rec = core.mergeSurvey(null, { domain: 'x.com', name: 'X', contacts: [] }, {
    group: 'business', title: 'Write to help@x.com',
    controls: [C({ type: 'email', placeholder: 'you@example.com', label: 'Email (name@address.com)', options: ['a@b.co=a@b.co'] })],
    buttons: [{ text: 'Send to jane@company.com', inForm: true }],
    contacts: ['privacy@x.com'],
  });
  const { contacts, ...rest } = rec.survey;
  assert.deepEqual(contacts, ['privacy@x.com']);
  assert.doesNotMatch(JSON.stringify(rest), /[\w.+-]+@[\w-]+\.[\w.-]+/);
  assert.equal(rest.controls[0].placeholder, '[email]');
  assert.equal(rest.controls[0].type, 'email');
});

test('mergeSurvey turns em and en dashes in site text into hyphens (house style)', () => {
  const rec = core.mergeSurvey(null, { domain: 'x.com', name: 'X', contacts: [] }, {
    group: 'business', title: 'Opt Out \u2014 X', text: 'Rights \u2013 opt-out',
    controls: [C({ label: 'Name \u2014 first' })], contacts: [],
  });
  const s = JSON.stringify(rec);
  assert.ok(!s.includes('\u2014') && !s.includes('\u2013'));
  assert.equal(rec.survey.title, 'Opt Out - X');
});

// 2026-10-15: catalog-check relabelled the 4 reviewed people-search sites
// "business" (the form page has no people-search wording). A reviewed or
// otherwise decided record keeps the group it was reviewed under.
test('mergeSurvey keeps the group of a record that is no longer unreviewed', () => {
  const prev = { domain: 'acme.com', name: 'Acme', group: 'people-search', review: { state: 'reviewed' } };
  const merged = core.mergeSurvey(prev, { domain: 'acme.com', urls: ['https://acme.com/'] }, { group: 'business', checkedAt: 'x' });
  assert.equal(merged.group, 'people-search');
  const fresh = core.mergeSurvey({ domain: 'b.com', group: 'unknown', review: { state: 'unreviewed' } }, { domain: 'b.com', urls: [] }, { group: 'business' });
  assert.equal(fresh.group, 'business', 'an unreviewed record still takes the survey group');
});

// Review 2026-10-15: a re-survey replaced survey.contacts, so a page that timed
// out or moved its mailto made an email record invalid (its `to` must come from
// survey.contacts) and loadCatalog dropped the broker with only a warning.
test('mergeSurvey keeps earlier contacts, and a failed re-survey keeps the earlier survey', () => {
  const existing = {
    domain: 'acme.example', name: 'Acme', group: 'business', sources: ['ca-registry'], formHosts: [],
    survey: { checkedAt: 'old', status: 200, optOutUrl: 'https://acme.example/privacy', controls: ['#x'], fingerprint: 'abc', contacts: ['privacy@acme.example'] },
    review: { state: 'email', to: 'privacy@acme.example' },
  };
  const cand = { domain: 'acme.example', name: 'Acme', sources: ['ca-registry'], contacts: [] };

  const ok = core.mergeSurvey(existing, cand, { group: 'business', checkedAt: 'new', status: 200, contacts: ['help@acme.example'] });
  assert.deepEqual(ok.survey.contacts.sort(), ['help@acme.example', 'privacy@acme.example']);

  const failed = core.mergeSurvey(existing, cand, { group: 'unknown', checkedAt: 'new', error: 'Timeout 20000ms', contacts: [] });
  assert.equal(failed.survey.fingerprint, 'abc', 'the earlier survey stays');
  assert.deepEqual(failed.survey.controls, ['#x']);
  assert.equal(failed.survey.checkedAt, 'new');
  assert.match(failed.survey.error, /Timeout/);
  assert.deepEqual(failed.survey.contacts, ['privacy@acme.example']);
  assert.equal(failed.group, 'business');
});
