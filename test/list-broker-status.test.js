/**
 * test/list-broker-status.test.js
 *
 * The broker table in `upec-wipe list` says what each broker is waiting on,
 * leaves out brokers that do not apply to the member (a states-limited one
 * such as California DROP), and leaves email brokers to the Email section.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { brokerStatus, brokerRows, catalogRows } = require('../lib/list-status');

test('each state entry maps to what the member is waiting on', () => {
  assert.deepEqual(brokerStatus(undefined), { status: 'never run', date: '-' });
  assert.deepEqual(brokerStatus({ lastSuccess: '2026-10-14T10:00:00Z' }), { status: 'success', date: '2026-10-14' });
  assert.deepEqual(brokerStatus({ lastAttempt: '2026-10-13T10:00:00Z', pendingConfirm: { since: '2026-10-12T10:00:00Z' } }),
    { status: 'awaiting confirm', date: '2026-10-12' });
  assert.deepEqual(brokerStatus({ pendingConfirmation: { since: '2026-10-12T10:00:00Z' } }),
    { status: 'awaiting confirm', date: '2026-10-12' });
  assert.deepEqual(brokerStatus({ manual: { since: '2026-10-11T10:00:00Z', detail: 'x' } }),
    { status: 'do by hand', date: '2026-10-11' });
  assert.deepEqual(brokerStatus({ history: ['error'], lastAttempt: '2026-10-10T10:00:00Z' }),
    { status: 'failed', date: '2026-10-10' });
  assert.deepEqual(brokerStatus({ history: ['captcha_failed'] }), { status: 'failed', date: '-' });
  assert.deepEqual(brokerStatus({ lastAttempt: '2026-10-09T10:00:00Z' }), { status: 'attempted', date: '2026-10-09' });
});

test('a search with no listing and a form with no confirmation are not "never run"', () => {
  assert.deepEqual(brokerStatus({ history: ['not_found'], lastAttempt: '2026-10-14T10:00:00Z' }),
    { status: 'not listed', date: '2026-10-14' });
  assert.deepEqual(brokerStatus({ history: ['error', 'unverified'], lastAttempt: '2026-10-15T10:00:00Z' }),
    { status: 'unverified', date: '2026-10-15' });
});

test('a pending confirmation or a manual hand-off wins over an older success', () => {
  const old = '2026-01-01T00:00:00Z';
  assert.equal(brokerStatus({ lastSuccess: old, pendingConfirm: { since: '2026-10-12T00:00:00Z' } }).status, 'awaiting confirm');
  assert.equal(brokerStatus({ lastSuccess: old, manual: { since: '2026-10-12T00:00:00Z' } }).status, 'do by hand');
  assert.equal(brokerStatus({ lastSuccess: old, history: ['success', 'error'] }).status, 'success');
});

test('brokerRows drops email brokers and brokers limited to other states', () => {
  const brokers = [
    { name: 'Golden State Only', method: 'manual', states: ['CA'] },
    { name: 'Everywhere', method: 'direct-form' },
    { name: 'Mail Only', method: 'email', emailTo: 'privacy@mail.example' },
  ];
  const rows = brokerRows(brokers, { optOuts: { Everywhere: { lastSuccess: '2026-10-14T00:00:00Z' } } },
    [{ firstName: 'Jane', lastName: 'Doe', state: 'TX' }]);
  assert.deepEqual(rows, [{ name: 'Everywhere', status: 'success', date: '2026-10-14' }]);
});

test('a states-limited broker shows for a person who lives there, and when no state is known', () => {
  const brokers = [{ name: 'Golden State Only', method: 'manual', states: ['CA'] }];
  assert.equal(brokerRows(brokers, {}, [{ state: 'California' }]).length, 1);
  assert.equal(brokerRows(brokers, {}, []).length, 1);
});

test('a by-hand broker with no record yet is "do by hand", not "never run"', () => {
  const rows = brokerRows([{ name: 'Hand Only', method: 'manual' }, { name: 'Form', method: 'direct-form' }], {}, []);
  assert.deepEqual(rows.map(r => r.status), ['do by hand', 'never run']);
});

const rec = (domain, name, review) => ({ domain, name, sources: ['markup'], group: 'people-search', review });
const RECORDS = [
  rec('handdata.example', 'Hand Data, LLC', { state: 'manual', reviewedAt: '2026-10-11', optOutUrl: 'https://handdata.example/p' }),
  rec('donedata.example', 'Done Data, Inc', { state: 'manual', reviewedAt: '2026-10-11', optOutUrl: 'https://donedata.example/p' }),
  rec('formdata.example', 'Form Data', { state: 'reviewed', reviewedAt: '2026-10-12', definition: {
    method: 'direct-form', optOutUrl: 'https://formdata.example/o', formFields: { '#e': '{email}' }, submitSelector: 'button' } }),
  rec('changed.example', 'Changed Site', { state: 'needs-review', reviewedAt: '2026-10-12', optOutUrl: 'https://changed.example/o', note: 'moved' }),
  rec('notpeople.example', 'Not People', { state: 'excluded', reviewedAt: '2026-10-12' }),
  rec('later.example', 'Later', { state: 'unreviewed' }),
  rec('mailer.example', 'Mailer', { state: 'email', to: 'privacy@mailer.example' }),
];

test('catalogRows uses the names runs record state under, and member statuses', () => {
  const state = { optOuts: { 'Done Data': { lastSuccess: '2026-10-14T00:00:00Z' } } };
  assert.deepEqual(catalogRows(RECORDS, state, []), [
    { name: 'Hand Data', status: 'do by hand', date: '-' },
    { name: 'Done Data', status: 'success', date: '2026-10-14' },
    { name: 'Form Data', status: 'never run', date: '-' },
    { name: 'Changed Site', status: 'do by hand', date: '-' },
  ]);
});

test('catalogRows leaves out a site an explicit broker already covers', () => {
  const brokers = [{ name: 'Hand Main', method: 'direct-form', optOutUrl: 'https://www.handdata.example/x' }];
  assert.deepEqual(catalogRows(RECORDS, {}, brokers).map(r => r.name), ['Done Data', 'Form Data', 'Changed Site']);
});

// Spawned in a config-free copy of the repo with its own empty state file.
const { makeFixtureRepo, runIn } = require('./helpers/fixture-repo');
const FIXTURE = makeFixtureRepo();
test.after(() => fs.rmSync(FIXTURE, { recursive: true, force: true }));

test('upec-wipe list: no email brokers in the broker table, and a Status column', () => {
  const r = runIn(FIXTURE, 'bin/upec-wipe.js', ['list'], { statePath: path.join(FIXTURE, 'state.test.json') });
  const out = (r.stdout || '') + (r.stderr || '');
  assert.equal(r.status, 0, out);
  const table = out.split(/\nCatalog sites/)[0];
  assert.match(table, /^Broker\s+Status\s+Date$/m);
  assert.doesNotMatch(table, /^(Pipl|Spokeo \(email\))\s/m);
  assert.match(table, /^Spokeo\s+never run\s+-$/m);
  const catalog = out.split(/\nCatalog sites/)[1].split(/\nEmail requests/)[0];
  assert.doesNotMatch(catalog, /\d{4}-\d{2}-\d{2}\s+\S/, 'no review dates in the catalog section');
  assert.doesNotMatch(catalog, /^.{40}manual\b/m);
  assert.match(catalog, /^.{40}do by hand\s+-$/m);
});
