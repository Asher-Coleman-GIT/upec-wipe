/**
 * test/dob.test.js
 *
 * 2026-10-11: optional date of birth, used only where a form requires it.
 * The real-email opt-in built alongside it was withdrawn the same day (it only
 * reached Spokeo and Pipl): emailed opt-outs carry the alias alone.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
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

// ── email opt-outs ─────────────────────────────────────────────────────────
const SMTP_CFG = { host: 'smtp.example.com', port: 587, user: 'u@x.com', pass: 'pw', from: 'u@x.com' };
const BROKER = { name: 'Pipl', method: 'email', emailTo: 'privacy@pipl.com' };
const ALIAS = 'jane.masked@aliases.simplelogin.io';

async function send(person) {
  const configMod = require('../lib/config');
  const loggerMod = require('../lib/logger');
  const saved = [configMod.lastOptOutDaysAgo, configMod.recordSuccess, loggerMod.logResult];
  configMod.lastOptOutDaysAgo = () => 999; configMod.recordSuccess = () => {}; loggerMod.logResult = () => {};
  const calls = [];
  const origLoad = Module._load;
  Module._load = function (request) {
    if (request === 'nodemailer') return { createTransport: () => ({ sendMail: async (o) => { calls.push(o); } }) };
    if (request === './egress') return { ensureNodeEgress: async () => {} };
    return origLoad.apply(this, arguments);
  };
  delete require.cache[require.resolve('../lib/email')];
  try {
    await require('../lib/email').sendOptOutEmails([BROKER], { person, email: { smtp: SMTP_CFG } }, 'linux', { submissionEmailFor: () => ALIAS });
  } finally {
    Module._load = origLoad;
    delete require.cache[require.resolve('../lib/email')];
    [configMod.lastOptOutDaysAgo, configMod.recordSuccess, loggerMod.logResult] = saved;
  }
  return calls[0];
}

test('the real email never appears in an emailed opt-out, even with the old removeRealEmail flag set', async () => {
  const mail = await send({ ...P, fullName: 'Jane Doe', removeRealEmail: true });
  assert.ok(!mail.text.includes('jane.doe@example.com'));
  assert.equal(mail.replyTo, ALIAS);
});
