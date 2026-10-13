'use strict';
/**
 * test/minimize-data.test.js - keep less about the member, let --only/--skip
 * reach the email step, and remind a forms run about unsent email requests.
 * Dummy person only.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JANE = { firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', city: 'Austin', state: 'UT', zip: '84101', country: 'US', email: 'jane@example.com' };

const ANSWERS = { firstName: 'Jane', lastName: 'Doe', city: 'Austin', country: 'US', state: 'TX', zip: '73301', email: 'jane@example.com', dob: '', capsolverKey: '', simpleloginKey: '', profileDir: '/tmp/x' };

test('setup writes no phone or aliases, and drops old ones', () => {
  const { buildConfig } = require('../setup');
  const prev = { person: { phone: '5125550000', phoneFormatted: '(512) 555-0000', aliases: ['Jan Doe'] } };
  const p = buildConfig(prev, ANSWERS).person;
  for (const k of ['phone', 'phoneFormatted', 'aliases']) assert.equal(k in p, false, k);
});

test('setup no longer asks for a phone or aliases', () => {
  const src = fs.readFileSync(path.join(ROOT, 'setup.js'), 'utf8');
  assert.doesNotMatch(src, /ask\('Phone/);
  assert.doesNotMatch(src, /ask\('Aliases/);
});

test('the example config holds no phone or aliases', () => {
  const ex = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.example.json'), 'utf8'));
  for (const k of ['phone', 'phoneFormatted', 'aliases', '_phone_note']) assert.equal(k in ex.person, false, k);
});

test('the audit file names the person without their real email', () => {
  const { renderAuditMarkdown } = require('../lib/audit');
  const md = renderAuditMarkdown({ person: JANE, timestamp: '2026-10-13T09:00:00.000Z', results: {} });
  assert.match(md, /\*\*Requested by:\*\* Jane Doe$/m);
  assert.doesNotMatch(md, /jane@example\.com/);
});

test('doctor flags a leftover phone or aliases', async () => {
  const { checkRetiredSettings } = require('../lib/doctor');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-min-'));
  try {
    const r = await checkRetiredSettings({ person: { phone: '5125550000', aliases: [] } }, root);
    assert.equal(r.ok, false);
    assert.match(r.hint, /person\.phone is not used: remove it from config\.json to keep less about you/);
    assert.match(r.hint, /person\.aliases is not used: remove it from config\.json to keep less about you/);
    assert.equal((await checkRetiredSettings({ person: { firstName: 'Jane' } }, root)).ok, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

const TARGETS = [
  { name: 'Acme Data', to: 'privacy@acme.example', basis: { kind: 'all-us' } },
  { name: 'Beta Brokers', to: 'privacy@beta.example', basis: { kind: 'utah' } },
];

test('--only and --skip reach the email plan', () => {
  const { buildEmailPlan } = require('../lib/email-step');
  const base = { targets: TARGETS, brokers: [], persons: [JANE], state: {}, from: 'box@example.com', maxPerRun: 100 };
  assert.deepEqual(buildEmailPlan(base).items.map(i => i.name), ['Acme Data', 'Beta Brokers']);
  assert.deepEqual(buildEmailPlan({ ...base, only: 'Beta Brokers' }).items.map(i => i.name), ['Beta Brokers']);
  assert.deepEqual(buildEmailPlan({ ...base, skip: 'Acme Data' }).items.map(i => i.name), ['Beta Brokers']);
});

test('--only that names no email broker sends nothing and says so', async () => {
  const { runEmailStep } = require('../lib/email-step');
  const out = [];
  let sent = 0;
  const code = await runEmailStep({
    config: { email: { smtp: { host: 'smtp.example.com', user: 'box@example.com', from: 'box@example.com', pass: 'x' } }, relay: {} },
    persons: [JANE], state: {}, save: () => {}, targets: TARGETS, brokers: [], preview: true,
    isTTY: true, ask: async () => 'SEND', log: (l) => out.push(l), only: 'Nobody Inc',
    makeTransport: () => ({ sendMail: async () => { sent++; return {}; } }), ensureEgress: async () => {}, sleep: async () => {},
  });
  assert.equal(code, 0);
  assert.equal(sent, 0);
  assert.ok(out.includes('No email request matches --only Nobody Inc.'), out.join('\n'));
});

test('a forms run reminds about unsent email requests', () => {
  const { emailReminder } = require('../lib/email-step');
  const base = { targets: TARGETS, brokers: [], persons: [JANE], state: {} };
  assert.equal(emailReminder({ ...base, config: { email: { smtp: { from: 'box@example.com' } } } }),
    'Email requests not yet sent: 2 - run `upec-wipe run --email`.');
  assert.equal(emailReminder({ ...base, config: {} }),
    '2 brokers take requests only by email: set up email requests with `upec-wipe setup`, or handle them by hand.');
  const sentState = { emailSent: { 'Acme Data': { at: 't' }, 'Beta Brokers': { at: 't' } } };
  assert.equal(emailReminder({ ...base, state: sentState, config: { email: { smtp: { from: 'box@example.com' } } } }), null);
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'modes', 'run.js'), 'utf8');
  assert.match(src, /emailReminder\(/);
});

test('the docs no longer say setup asks for a phone or that the audit file holds the real email', () => {
  const manual = fs.readFileSync(path.join(ROOT, 'docs', 'UPEC-MANUAL.md'), 'utf8');
  assert.doesNotMatch(manual, /zip, email and phone|aliases \(other names/);
  const privacy = fs.readFileSync(path.join(ROOT, 'docs', 'PRIVACY.md'), 'utf8');
  assert.doesNotMatch(privacy, /full name and \*\*real email\*\*/);
  assert.doesNotMatch(privacy, /^\| `person\.phone`/m);
});
