'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateRecord, catalogEmailTargets } = require('../lib/catalog');

const rec = (review, extra = {}) => ({
  domain: 'example-broker.com', name: 'Example Broker, Inc.', group: 'business', formHosts: [],
  survey: { contacts: ['privacy@example-broker.com'] },
  review, ...extra,
});
const good = () => ({
  state: 'email', reviewedAt: '2026-10-12', to: 'privacy@example-broker.com',
  basis: { kind: 'utah', quote: 'Residents of Colorado, Utah and Virginia have these rights.', url: 'https://www.example-broker.com/privacy' },
});

test('a valid email record validates', () => {
  assert.equal(validateRecord(rec(good())), null);
});

test('to is matched against survey.contacts case-insensitively', () => {
  assert.equal(validateRecord(rec({ ...good(), to: 'Privacy@Example-Broker.com' })), null);
});

test('to must come from survey.contacts', () => {
  assert.match(validateRecord(rec({ ...good(), to: 'someone@example-broker.com' })), /survey\.contacts/);
});

test('basis.kind must be utah or all-us', () => {
  const r = good(); r.basis.kind = 'california';
  assert.match(validateRecord(rec(r)), /basis\.kind/);
});

test('basis.quote must be non-empty, at most 400 chars, with no address', () => {
  const a = good(); a.basis.quote = '';
  assert.match(validateRecord(rec(a)), /basis\.quote/);
  const b = good(); b.basis.quote = 'x'.repeat(401);
  assert.match(validateRecord(rec(b)), /basis\.quote/);
  const c = good(); c.basis.quote = 'Write to privacy@example-broker.com for help.';
  assert.match(validateRecord(rec(c)), /email address/);
});

test('basis.url must be https on the domain or a form host', () => {
  const a = good(); a.basis.url = 'http://www.example-broker.com/privacy';
  assert.match(validateRecord(rec(a)), /https/);
  const b = good(); b.basis.url = 'https://elsewhere.com/privacy';
  assert.match(validateRecord(rec(b)), /not on example-broker\.com/);
  const c = good(); c.basis.url = 'https://privacyportal.onetrust.com/x';
  assert.equal(validateRecord(rec(c, { formHosts: ['onetrust.com'] })), null);
});

test('catalogEmailTargets lists email records with run names', () => {
  const other = rec({ state: 'manual', optOutUrl: 'https://www.example-broker.com/x' }, { domain: 'other.com', name: 'Other LLC' });
  const t = catalogEmailTargets([rec(good()), other]);
  assert.deepEqual(t, [{ name: 'Example Broker', domain: 'example-broker.com', to: 'privacy@example-broker.com', basis: good().basis }]);
});

test('catalogEmailTargets appends the domain when a name collides', () => {
  const t = catalogEmailTargets([rec(good())], { explicitNames: new Set(['example broker']) });
  assert.equal(t[0].name, 'Example Broker (example-broker.com)');
});
