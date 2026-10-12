/**
 * test/dob.test.js
 *
 * 2026-10-11: optional date of birth, used only where a form requires it.
 * The real-email opt-in built alongside it was withdrawn the same day (it only
 * reached Spokeo and Pipl). Emailed requests go through lib/email-step.js and are tested there.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDob } = require('../lib/dob');
const { buildConfig } = require('../setup');
const { forPerson } = require('../brokers');

const BASE = { firstName: 'Jane', lastName: 'Doe', aliases: [], city: 'Austin', country: 'US', state: 'TX', zip: '73301', email: 'jane.doe@example.com', phone: 'p', phoneFormatted: 'pf', capsolverKey: '', profileDir: '/p' };

test('parseDob accepts YYYY-MM-DD and rejects anything else', () => {
  assert.deepEqual(parseDob('1990-04-07'), { year: '1990', month: 4, monthName: 'April', day: '7' });
  for (const bad of ['', '04/07/1990', '1990-13-01', '1990-02-30', '2999-01-01', 'abc']) assert.equal(parseDob(bad), null, bad);
});

test('setup stores the date of birth', () => {
  const out = buildConfig({}, { ...BASE, dob: '1990-04-07' });
  assert.equal(out.person.dob, '1990-04-07');
});

test('a blank date of birth is not stored', () => {
  const out = buildConfig({}, { ...BASE, dob: '' });
  assert.equal('dob' in out.person, false);
});

test('setup asks for the date of birth and has no real-email opt-in', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'setup.js'), 'utf8');
  assert.match(src, /Date of birth/);
  assert.doesNotMatch(src, /removeRealEmail/);
});

const P = { firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', city: 'Austin', state: 'TX', zip: '73301', email: 'jane.doe@example.com', country: 'US' };

test('PrivateRecords fills the birth date dropdowns and requires a date of birth', () => {
  const b = forPerson({ ...P, dob: '1990-04-07' }).find(x => x.name === 'PrivateRecords');
  assert.equal(b.formFields['#dob-m'], 'April');
  assert.equal(b.formFields['#dob-d'], '7');
  assert.equal(b.formFields['#dob-y'], '1990');
  assert.deepEqual(b.requires, ['dob']);
});

test('without a date of birth PrivateRecords carries no birth date values', () => {
  const b = forPerson(P).find(x => x.name === 'PrivateRecords');
  assert.equal(b.formFields['#dob-m'], '');
});
