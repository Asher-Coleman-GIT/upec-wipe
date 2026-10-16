'use strict';
/**
 * test/catalog-email-to-manual.test.js
 *
 * 2026-10-15: 17 catalog brokers (and Spokeo, whose email entry is gone) answered the email request with
 * "we do not accept email, use our form". They are manual now (the form is
 * the link `upec-wipe manual` hands over), so they are never emailed again.
 * Their earlier sends stay in state, so `reply` and `read-email` still know
 * them by name.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadCatalog, catalogEmailTargets } = require('../lib/catalog');
const { emailedTargets } = require('../lib/read-email');
const { replyNames } = require('../lib/email-step');

const MOVED = {
  'adstradata.com': 'Adstra', 'catalist.us': 'Catalist', 'clearview.ai': 'Clearview AI', 'completemedicallists.com': 'Complete Medical Lists',
  'datapartners.com': 'Data Partners', 'dealmachine.com': 'DealMachine Operations', 'thedatatrust.com': 'DT Client Services', 'eltoro.com': 'EL TORO.COM',
  'exactmatchmarketing.com': 'Exact Match Marketing', 'fideo.ai': 'Fideo Intelligence', 'fraiser.org': 'Fraiser', 'messagedigital.com': 'Message Digital',
  'thebridgecorp.com': 'OWMN', 'monitorbase.com': 'Ownco', 'popacta.com': 'Pop Acta Media', 'thedatagroup.com': 'The Data Group', 'wiland.com': 'Wiland',
};
const records = loadCatalog(undefined, () => {});

test('the 17 brokers that refused email are manual records with their form', () => {
  for (const [domain, name] of Object.entries(MOVED)) {
    const r = records.find(x => x.domain === domain);
    assert.ok(r, `${domain} loads (valid record)`);
    assert.ok(r.name.startsWith(name), `${domain}: ${r.name}`);
    assert.equal(r.review.state, 'manual', domain);
    assert.match(r.review.optOutUrl, /^https:\/\//, domain);
    assert.match(r.review.notes, /2026-10-15/, `${domain}: the note says when and why`);
  }
});

test('they are no longer email targets', () => {
  const names = catalogEmailTargets(records, { explicitNames: new Set() }).map(t => t.name);
  for (const name of Object.values(MOVED)) assert.equal(names.includes(name), false, name);
  // Spokeo's reply pointed to its own opt-out, which the Spokeo entry runs.
  assert.equal(require('../brokers').some(b => b.name === 'Spokeo (email)'), false);
});

test('reply and read-email still know a broker that was emailed before it moved', () => {
  const state = { emailSent: { Fraiser: { to: 'privacy@fraiser.org', at: '2026-10-15T09:00:00Z' }, 'Wiland|Jane Doe': { to: 'privacy@wiland.com', at: 'x' } } };
  const names = replyNames({ targets: [], brokers: [], state });
  assert.ok(names.includes('Fraiser'));
  assert.ok(names.includes('Wiland'));
  const t = emailedTargets({ catalogRecords: records, brokers: [], state });
  const fraiser = t.find(x => x.name === 'Fraiser');
  assert.equal(fraiser.domain, 'fraiser.org');
  assert.equal(t.filter(x => x.name === 'Fraiser').length, 1);
});

// DataDelivers' privacy address bounced (2026-10-15); its site's own "Do Not
// Sell" link is a hosted request portal, so members are sent there instead.
test('DataDelivers, whose address bounced, is manual with its request portal', () => {
  const r = records.find(x => x.domain === 'datadelivers.com');
  assert.equal(r.review.state, 'manual');
  assert.match(r.review.optOutUrl, /^https:\/\/dsr\.trustsuperset\.com\//);
  assert.match(r.review.notes, /bounced/i);
  assert.match(r.review.notes, /2026-10-15/);
  const names = catalogEmailTargets(records, { explicitNames: new Set() }).map(t => t.name);
  assert.equal(names.includes('DataDelivers'), false);
});

// Innovation Brands accepts email but answers with a mailbox check: it stays
// an email target and its record says what to expect.
test('Innovation Brands stays an email target and notes its verification link', () => {
  const r = records.find(x => x.domain === 'proxima.ai' && x.review.state === 'email');
  assert.match(r.review.note, /verif/i);
  const names = catalogEmailTargets(records, { explicitNames: new Set() }).map(t => t.name);
  assert.ok(names.includes('Innovation Brands'));
});
