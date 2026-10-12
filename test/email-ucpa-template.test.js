'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildUcpaRequest } = require('../lib/email');
const example = require('../config.example.json');

const P = example.person;
const UT = { ...P, city: 'Provo', state: 'UT', dob: '1980-03-15' };
const CONTACT = 'requests.only@example.net';

test('subject and the three requests', () => {
  const { subject, body } = buildUcpaRequest(UT, CONTACT);
  assert.equal(subject, 'Privacy request: opt out of sale and targeted advertising, and delete');
  assert.match(body, /Utah Consumer Privacy Act/);
  assert.match(body, /stop selling or sharing my personal data/);
  assert.match(body, /targeted advertising/);
  assert.match(body, /delete my personal data/);
});

test('identifies by name, city and state, contact is the dedicated address', () => {
  const { body } = buildUcpaRequest(UT, CONTACT);
  assert.ok(body.includes(`Name: ${UT.fullName}`));
  assert.ok(body.includes('Location: Provo, Utah'));
  assert.ok(body.includes(CONTACT));
});

test('never carries email, phone, zip, date of birth or a relay alias', () => {
  const { subject, body } = buildUcpaRequest({ ...UT, relayAlias: 'alias123@simplelogin.com' }, CONTACT);
  const text = subject + '\n' + body;
  for (const v of [P.email, P.phone, P.phoneFormatted, P.zip, '1980', 'simplelogin']) {
    assert.ok(!text.includes(v), `leaked ${v}`);
  }
});

test('a person outside Utah gets no Utah residency claim', () => {
  const { body } = buildUcpaRequest(P, CONTACT); // Austin, TX
  assert.ok(!/I am a Utah resident/.test(body));
  assert.match(body, /Texas/);
  assert.match(body, /privacy law that applies/);
});
