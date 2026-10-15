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
const { brokerStatus, brokerRows } = require('../lib/list-status');

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
});
