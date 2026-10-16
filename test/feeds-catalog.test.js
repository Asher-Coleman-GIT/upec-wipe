// test/feeds-catalog.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFeedRow, normalizeRegistryCsv } = require('../lib/feeds');

test('a registry email column is kept as contact', () => {
  const e = normalizeFeedRow({ 'data broker name': 'Acme', 'website url': 'https://acme.example.com', 'email address': 'privacy@acme.example.com' }, 'ca');
  assert.equal(e.contact, 'privacy@acme.example.com');
});

test('no contact key when the email column is empty or not an email', () => {
  assert.equal('contact' in normalizeFeedRow({ 'data broker name': 'A', 'website url': 'https://a.example.com' }, 'ca'), false);
  assert.equal('contact' in normalizeFeedRow({ 'data broker name': 'A', 'website url': 'https://a.example.com', email: 'n/a' }, 'vt'), false);
});

test('an HTML page instead of CSV is refused with a clear message', () => {
  assert.throws(() => normalizeRegistryCsv('<!DOCTYPE html><html></html>', 'ca'), /California registry download is a web page, not CSV/);
  assert.throws(() => normalizeRegistryCsv('  <html>', 'vt'), /Vermont registry download is a web page, not CSV/);
});

// 2026-10-12: the CPPA registry (cppa.ca.gov/data_broker_registry/registry.csv)
// ends every column title with a colon and has a separate privacy-rights page.
test('the CPPA 2026 registry layout is read', () => {
  const csv = [
    'Data broker name:,"Doing Business As (DBA), if applicable:",Data broker primary website:,Data broker primary contact email address:,Data broker primary phone number: [optional],Data broker\'s primary website that contains details on how consumers can exercise their CA Consumer Privacy rights:',
    'Acme Data LLC,,https://www.acme.example.com,Privacy@Acme.example.com,,https://www.acme.example.com/privacy-request',
  ].join('\n');
  const [row] = normalizeRegistryCsv(csv, 'ca');
  assert.equal(row.name, 'Acme Data LLC');
  assert.equal(row.optOutUrl, 'https://www.acme.example.com/privacy-request');
  assert.equal(row.contact, 'privacy@acme.example.com');
});

test('without a privacy-rights column the primary website is used', () => {
  const csv = 'Data broker name:,Data broker primary website:\nBeta Co,https://beta.example.com';
  assert.equal(normalizeRegistryCsv(csv, 'ca')[0].optOutUrl, 'https://beta.example.com');
});

test('one registry failing does not discard the other', async () => {
  const { buildFeedsFile } = require('../lib/feeds');
  const logs = [];
  const fetchImpl = async (url) => url.includes('cppa')
    ? { ok: true, status: 200, text: async () => 'Data broker name:,Data broker primary website:\nAcme,https://acme.example.com' }
    : { ok: true, status: 200, text: async () => '<!DOCTYPE html><html></html>' };
  const out = await buildFeedsFile({ fetchImpl, logFn: (m) => logs.push(m) });
  assert.deepEqual(out.brokers.map(b => b.name), ['Acme']);
  assert.deepEqual(out.stats, { ca: 1, vt: 0, total: 1 });
  assert.match(logs.join('\n'), /Vermont registry skipped: Vermont registry download is a web page/);
});

// Review 2026-10-15: the California CSV has quoted cells with line breaks;
// splitting on newlines first cut the broker's row short (no URL or contact)
// and turned the rest into fake "brokers" (about 69 in data/feeds-brokers.json).
test('a quoted cell with line breaks stays one row', () => {
  const { normalizeRegistryCsv } = require('../lib/feeds');
  const csv = 'Data Broker Name,Notes,Website URL,Email Address\r\nAcme Data LLC,"line one\r\nline two, with a comma\nline three",https://acme.example/opt-out,privacy@acme.example\r\nBeta Co,,https://beta.example/,\r\n';
  const rows = normalizeRegistryCsv(csv, 'ca', () => {});
  assert.deepEqual(rows.map(r => r.name), ['Acme Data LLC', 'Beta Co']);
  assert.equal(rows[0].optOutUrl, 'https://acme.example/opt-out');
});
