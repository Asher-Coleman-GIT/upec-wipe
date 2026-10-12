'use strict';
// Setup asks for the dedicated mailbox used by `upec-wipe run --email` (phase 2).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildConfig, dedicatedMailboxProblem } = require('../setup');

const answers = (extra = {}) => ({
  firstName: 'Jane', lastName: 'Doe', aliases: [], city: 'Provo', country: 'US', state: 'UT', zip: '84601',
  email: 'jane.doe@example.com', phone: '8015550000', phoneFormatted: '(801) 555-0000', dob: '',
  capsolverKey: '', simpleloginKey: '', profileDir: '/tmp/p', ...extra,
});
const MAILBOX = 'requests.only@example.net';

test('a dedicated mailbox writes email.smtp with user = from and the pacing defaults', () => {
  const cfg = buildConfig({}, answers({ mailbox: MAILBOX, smtpHost: 'smtp.gmail.com', appPassword: 'abcd efgh ijkl mnop' }));
  assert.deepEqual(cfg.email, {
    smtp: { host: 'smtp.gmail.com', port: 587, user: MAILBOX, pass: 'abcd efgh ijkl mnop', from: MAILBOX },
    paceSeconds: 45, maxPerRun: 100,
  });
});

test('a blank mailbox keeps an existing email block untouched, and adds none when absent', () => {
  const existing = { email: { smtp: { host: 'h', port: 465, user: 'old@example.net', pass: 'p', from: 'old@example.net' }, paceSeconds: 60, maxPerRun: 20 } };
  assert.deepEqual(buildConfig(existing, answers({ mailbox: '' })).email, existing.email);
  assert.equal(buildConfig({}, answers({ mailbox: '' })).email, undefined);
});

test('a blank app password keeps the stored one; other settings in the block survive', () => {
  const existing = { email: { smtp: { host: 'smtp.gmail.com', port: 587, user: MAILBOX, pass: 'stored', from: MAILBOX }, paceSeconds: 60, maxPerRun: 20 } };
  const cfg = buildConfig(existing, answers({ mailbox: MAILBOX, smtpHost: 'smtp.gmail.com', appPassword: '' }));
  assert.equal(cfg.email.smtp.pass, 'stored');
  assert.equal(cfg.email.paceSeconds, 60);
  assert.equal(cfg.email.maxPerRun, 20);
});

test('the real email, or something that is not an address, is refused as the dedicated mailbox', () => {
  assert.match(dedicatedMailboxProblem('Jane.Doe@Example.com', 'jane.doe@example.com'), /everyday|real/);
  assert.match(dedicatedMailboxProblem('not-an-address', 'jane.doe@example.com'), /address/);
  assert.equal(dedicatedMailboxProblem(MAILBOX, 'jane.doe@example.com'), null);
  assert.equal(dedicatedMailboxProblem('', 'jane.doe@example.com'), null); // blank = skip
});
