/**
 * test/setup-no-broker-accounts.test.js
 *
 * Audit H1 (follow-up C1 item 1). Setup used to walk members through creating
 * Spokeo, BeenVerified and MyLife accounts: it opened the signup page in the
 * everyday browser through `execSync(open ...)` (home IP, real cookies) and
 * defaulted the login email to the real address. Nothing in the fork reads
 * `accounts`, so the step and the key are gone.
 *
 * - buildConfig() for a new config has no `accounts` key.
 * - A legacy `accounts` key in an existing config is kept untouched (prev spread).
 * - setup.js has no account-creation prompt and never execSync()s a URL.
 * - config.example.json has no `accounts` block.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ANSWERS = {
  firstName: 'A', lastName: 'B', aliases: [], city: 'C', country: 'US',
  state: 'S', zip: 'Z', email: 'e@example.com', phone: 'p', phoneFormatted: 'pf',
  capsolverKey: 'K', profileDir: '/p',
};

test('buildConfig({}, answers) has no accounts key', () => {
  const { buildConfig } = require('../setup');
  const out = buildConfig({}, ANSWERS);
  assert.equal(Object.prototype.hasOwnProperty.call(out, 'accounts'), false);
});

test('buildConfig ignores an accounts answer for a new config', () => {
  const { buildConfig } = require('../setup');
  const out = buildConfig({}, { ...ANSWERS, accounts: { spokeo: { email: 'x', password: 'y' } } });
  assert.equal(Object.prototype.hasOwnProperty.call(out, 'accounts'), false);
});

test('buildConfig keeps a legacy accounts key from the existing config untouched', () => {
  const { buildConfig } = require('../setup');
  const legacy = { spokeo: { email: 'x@example.com', password: 'pw' } };
  const out = buildConfig({ accounts: legacy }, ANSWERS);
  assert.deepEqual(out.accounts, legacy);
});

test('setup.js has no broker account-creation step and no execSync of a URL', () => {
  const src = fs.readFileSync(path.join(ROOT, 'setup.js'), 'utf8');
  assert.doesNotMatch(src, /execSync\(/);
  assert.doesNotMatch(src, /Account Setup/i);
  assert.doesNotMatch(src, /\/signup/);
  assert.doesNotMatch(src, /login email/i);
  assert.doesNotMatch(src, /accounts\[/);
});

test('config.example.json has no accounts block', () => {
  const ex = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.example.json'), 'utf8'));
  assert.equal(Object.prototype.hasOwnProperty.call(ex, 'accounts'), false);
});
