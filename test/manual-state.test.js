/**
 * test/manual-state.test.js
 *
 * State for sites the member finishes by hand: recordManual keeps the first
 * `since` and the latest detail; a success or a pending confirmation clears it;
 * lib/manual.js lists the open entries and finds the keys `done` acts on.
 * Writes go through setDryRun(true), so state.json on disk is never touched.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const cfg = require('../lib/config');
const { manualEntries, keysFor, findBroker } = require('../lib/manual');

const N = '__test_manual_broker__';

function withCleanState(fn) {
  const state = cfg.loadState();
  const prev = state.optOuts[N];
  cfg.setDryRun(true);
  try {
    delete state.optOuts[N];
    fn(state);
  } finally {
    cfg.setDryRun(false);
    if (prev === undefined) delete state.optOuts[N];
    else state.optOuts[N] = prev;
  }
}

test('recordManual stores since and detail, keeping the first since', () => {
  withCleanState((state) => {
    cfg.recordManual(N, 'first - https://a.example/optout');
    const since = state.optOuts[N].manual.since;
    assert.equal(typeof since, 'string');
    cfg.recordManual(N, 'second - https://a.example/optout');
    assert.equal(state.optOuts[N].manual.since, since);
    assert.equal(state.optOuts[N].manual.detail, 'second - https://a.example/optout');
  });
});

test('recordSuccess and recordPendingConfirmation clear the manual entry', () => {
  withCleanState((state) => {
    cfg.recordManual(N, 'x');
    cfg.recordSuccess(N, 'done by hand');
    assert.equal(state.optOuts[N].manual, undefined);
    cfg.recordManual(N, 'y');
    cfg.recordPendingConfirmation(N, 'check your email');
    assert.equal(state.optOuts[N].manual, undefined);
  });
});

test('manualEntries lists open entries oldest first, with the broker name split from the person', () => {
  const state = { optOuts: {
    B: { manual: { since: '2026-10-14T10:00:00Z', detail: 'b link' } },
    'A|Jane Doe': { manual: { since: '2026-10-13T10:00:00Z', detail: 'a link' } },
    C: { lastSuccess: '2026-10-14T00:00:00Z' },
  } };
  assert.deepEqual(manualEntries(state), [
    { key: 'A|Jane Doe', name: 'A', person: 'Jane Doe', since: '2026-10-13T10:00:00Z', detail: 'a link' },
    { key: 'B', name: 'B', person: '', since: '2026-10-14T10:00:00Z', detail: 'b link' },
  ]);
  assert.deepEqual(manualEntries({}), []);
});

test('keysFor returns every person key for a broker, or the bare name', () => {
  const state = { optOuts: { 'A|Jane Doe': {}, 'A|John Doe': {}, AB: {} } };
  assert.deepEqual(keysFor(state, 'A'), ['A|Jane Doe', 'A|John Doe']);
  assert.deepEqual(keysFor(state, 'Z'), ['Z']);
});

test('findBroker: exact name, case-insensitive, else a unique partial match, else an error', () => {
  const names = ['PeopleFinders', 'PeopleFinders Plus', 'SearchPeopleFree'];
  assert.deepEqual(findBroker(names, 'peoplefinders'), { name: 'PeopleFinders' });
  assert.deepEqual(findBroker(names, 'searchpeople'), { name: 'SearchPeopleFree' });
  assert.match(findBroker(names, 'people').error, /more than one/);
  assert.match(findBroker(names, 'nothing').error, /No broker or site matches "nothing"/);
});

test('importFromLog adds manual and CAPTCHA-failed sites, skipping ones already done or pending', () => {
  const { importFromLog } = require('../lib/manual');
  const log = {
    runAt: '2026-10-14T21:16:42.000Z',
    manual: [
      { broker: 'WhitePages', status: 'manual', detail: 'blocked by bot protection - open in your normal browser: https://www.whitepages.com/suppression-requests' },
      { broker: 'Done Site', status: 'manual', detail: 'https://done.example/optout' },
      { broker: 'WhitePages', status: 'manual', detail: 'duplicate line' },
    ],
    captchaFailed: [{ broker: 'FamilyTreeNow', status: 'captcha_failed', detail: 'https://www.familytreenow.com/optout' }],
  };
  const recorded = [];
  const n = importFromLog(log, {
    keyFor: (name) => name,
    shouldSkip: (key) => (key === 'Done Site' ? { reason: 'done' } : null),
    record: (key, detail, since) => recorded.push({ key, detail, since }),
  });
  assert.equal(n, 2);
  assert.deepEqual(recorded, [
    { key: 'WhitePages', detail: 'blocked by bot protection - open in your normal browser: https://www.whitepages.com/suppression-requests', since: '2026-10-14T21:16:42.000Z' },
    { key: 'FamilyTreeNow', detail: 'the CAPTCHA could not be solved - do it by hand: https://www.familytreenow.com/optout', since: '2026-10-14T21:16:42.000Z' },
  ]);
});

test('recordManual takes an explicit since for a new entry', () => {
  withCleanState((state) => {
    cfg.recordManual(N, 'x', '2026-10-14T21:16:42.000Z');
    assert.equal(state.optOuts[N].manual.since, '2026-10-14T21:16:42.000Z');
  });
});

test('findBroker: a legal name with its suffix matches the short catalog name', () => {
  const names = ['Adstra', 'DT Client Services', 'PeopleFinders'];
  assert.deepEqual(findBroker(names, 'Adstra LLC'), { name: 'Adstra' });
  assert.deepEqual(findBroker(names, 'DT Client Services, LLC'), { name: 'DT Client Services' });
});
