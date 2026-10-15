/**
 * test/brokers-survey-2026-10-11.test.js
 *
 * Pins brokers.js to the assisted live survey of 2026-10-11, run with the
 * member clearing each bot check (ASSIST=1 scripts/inspect-broker-forms.js).
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { forPerson } = require('../brokers');

const P = { firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', city: 'Austin', state: 'TX', zip: '73301', email: 'jane@example.com', country: 'US' };
const get = (n, p = P) => forPerson(p).find(b => b.name === n);
const keys = (n, p) => Object.keys(get(n, p).formFields || {});

test('TruePeopleSearch fills the opt-out form, never the header search box', () => {
  const k = keys('TruePeopleSearch');
  for (const s of ['#FirstName', '#LastName', '#Email', '#AuthorizeContact']) assert.ok(k.includes(s), s);
  assert.doesNotMatch(k.join(' '), /name\*=|placeholder/, 'no broad selector that also matches the search bar');
  assert.match(get('TruePeopleSearch').submitSelector, /Send Request/);
});

test('DataAxle is manual: the email box on its privacy page is a newsletter signup', () => {
  const b = get('DataAxle');
  assert.equal(b.method, 'manual');
  assert.equal(b.optOutUrl, 'https://www.data-axle.com/privacy-rights-request/');
  assert.ok(b.notes.includes(b.optOutUrl));
});

test('SmartBackgroundChecks uses the /remove form', () => {
  const b = get('SmartBackgroundChecks');
  assert.equal(b.optOutUrl, 'https://www.smartbackgroundchecks.com/remove');
  for (const s of ['#subject_fn', '#subject_ln', '#subject_email', '#confirm_authorize']) assert.ok(keys('SmartBackgroundChecks').includes(s), s);
});

test('FamilyTreeNow uses the surveyed ids and ticks the contact authorisation', () => {
  for (const s of ['#FirstName', '#LastName', '#Email', '#AuthorizeContact']) assert.ok(keys('FamilyTreeNow').includes(s), s);
  assert.match(get('FamilyTreeNow').submitSelector, /Begin Privacy Request/);
});

test('SocialCatfish also gives the state it asks for', () => {
  assert.equal(get('SocialCatfish').formFields['#ccpa_state'], 'TX');
});

test('PrivateRecords fills the whole removal form', () => {
  const f = get('PrivateRecords').formFields;
  assert.equal(f['#first'], 'Jane'); assert.equal(f['#last'], 'Doe');
  assert.equal(f['#city'], 'Austin'); assert.equal(f['#zip'], '73301'); assert.equal(f['#state'], 'TX');
  assert.equal(f['#contact-email'], 'jane@example.com');
  assert.equal(f['#r-removal'], 'on');
});

test('NationalPublicData is manual: removal needs your profile link', () => {
  const b = get('NationalPublicData');
  assert.equal(b.method, 'manual');
  assert.match(b.notes, /profile link/i);
});

test('BeenVerified is manual: you pick your own record from the results', () => {
  const b = get('BeenVerified');
  assert.equal(b.method, 'manual');
  assert.ok(b.notes.includes('https://www.beenverified.com/app/optout/search'));
});

test('MyLife points at its privacy request page, not the privacy policy', () => {
  assert.equal(get('MyLife').optOutUrl, 'https://www.mylife.com/privacyrequest');
});

test('MyLife is manual (2026-10-15: its search moved and ignores location; its form cannot be completed)', () => {
  const b = get('MyLife');
  assert.equal(b.method, 'manual');
  assert.equal(b.formFields, undefined);
  assert.match(b.notes, /mylife\.com\/privacyrequest/);
});

test('PeopleFinders fills only the step-one Right to Opt-Out form', () => {
  const b = get('PeopleFinders');
  const k = Object.keys(b.formFields);
  assert.ok(k.every(s => s.startsWith('form:has(button:has-text("Send Request"))')), 'every field is scoped to that form');
  assert.equal(b.formFields['form:has(button:has-text("Send Request")) select'], 'subject');
  assert.match(b.submitSelector, /Send Request/);
  assert.equal(b.captchaLikely, true);
});
