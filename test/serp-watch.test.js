/**
 * test/serp-watch.test.js
 *
 * Pure unit tests for lib/serp-watch.js.
 * No live network. No real browser. No disk I/O (deps are injected).
 *
 * Tested behaviours (this task):
 *  1. diffSerpResults(previous, current) - { newDomains, goneDomains, stillPresent }
 *  2. summaryHostnames(summary)          - broker hostnames from a runSerpScan summary
 *  3. historyHostnames(history)          - distinct hostnames from a history array
 */

'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

let origLog;
beforeEach(() => { origLog = console.log; console.log = () => {}; });
afterEach(() => { console.log = origLog; });

const {
  diffSerpResults,
  summaryHostnames,
  historyHostnames,
} = require('../lib/serp-watch');

// --- diffSerpResults ---------------------------------------------------------

test('diffSerpResults reports a domain present in current but not previous as new', () => {
  const diff = diffSerpResults(['spokeo.com'], ['spokeo.com', 'radaris.com']);
  assert.deepEqual(diff.newDomains, ['radaris.com']);
});

test('diffSerpResults reports a domain present in previous but not current as gone', () => {
  const diff = diffSerpResults(['spokeo.com', 'radaris.com'], ['spokeo.com']);
  assert.deepEqual(diff.goneDomains, ['radaris.com']);
});

test('diffSerpResults reports a domain present in both as stillPresent', () => {
  const diff = diffSerpResults(['spokeo.com', 'radaris.com'], ['spokeo.com', 'radaris.com']);
  assert.deepEqual(diff.stillPresent.sort(), ['radaris.com', 'spokeo.com']);
  assert.deepEqual(diff.newDomains, []);
  assert.deepEqual(diff.goneDomains, []);
});

test('diffSerpResults with empty previous treats every current domain as new', () => {
  const diff = diffSerpResults([], ['spokeo.com', 'radaris.com']);
  assert.deepEqual(diff.newDomains.sort(), ['radaris.com', 'spokeo.com']);
  assert.deepEqual(diff.goneDomains, []);
  assert.deepEqual(diff.stillPresent, []);
});

test('diffSerpResults with empty current reports everything gone', () => {
  const diff = diffSerpResults(['spokeo.com'], []);
  assert.deepEqual(diff.newDomains, []);
  assert.deepEqual(diff.goneDomains, ['spokeo.com']);
  assert.deepEqual(diff.stillPresent, []);
});

test('diffSerpResults with both empty returns all-empty arrays', () => {
  const diff = diffSerpResults([], []);
  assert.deepEqual(diff, { newDomains: [], goneDomains: [], stillPresent: [] });
});

test('diffSerpResults deduplicates repeated domains in inputs', () => {
  const diff = diffSerpResults(['spokeo.com', 'spokeo.com'], ['spokeo.com', 'spokeo.com', 'radaris.com', 'radaris.com']);
  assert.deepEqual(diff.newDomains, ['radaris.com']);
  assert.deepEqual(diff.stillPresent, ['spokeo.com']);
});

test('diffSerpResults result arrays are sorted for stable output', () => {
  const diff = diffSerpResults([], ['zlocate.com', 'apeople.com', 'mradaris.com']);
  assert.deepEqual(diff.newDomains, ['apeople.com', 'mradaris.com', 'zlocate.com']);
});

test('diffSerpResults ignores empty-string and falsy entries', () => {
  const diff = diffSerpResults(['', null, 'spokeo.com'], [undefined, '', 'radaris.com']);
  assert.deepEqual(diff.newDomains, ['radaris.com']);
  assert.deepEqual(diff.goneDomains, ['spokeo.com']);
});

// --- summaryHostnames --------------------------------------------------------

test('summaryHostnames maps a runSerpScan summary to its broker hostnames', () => {
  const summary = {
    total_brokers_appearing: 2,
    results: [
      { broker: 'Spokeo', hostname: 'spokeo.com', ranks: { ddg: 1, bing: null, google: null } },
      { broker: 'Radaris', hostname: 'radaris.com', ranks: { ddg: null, bing: 2, google: null } },
    ],
    blocked: [],
  };
  assert.deepEqual(summaryHostnames(summary).sort(), ['radaris.com', 'spokeo.com']);
});

test('summaryHostnames returns empty array for an empty summary', () => {
  assert.deepEqual(summaryHostnames({ total_brokers_appearing: 0, results: [], blocked: [] }), []);
});

test('summaryHostnames tolerates a null or malformed summary', () => {
  assert.deepEqual(summaryHostnames(null), []);
  assert.deepEqual(summaryHostnames({}), []);
  assert.deepEqual(summaryHostnames({ results: null }), []);
});

// --- historyHostnames --------------------------------------------------------

test('historyHostnames returns distinct hostnames from a history array', () => {
  const history = [
    { hostname: 'spokeo.com' },
    { hostname: 'spokeo.com' },
    { hostname: 'radaris.com' },
  ];
  assert.deepEqual(historyHostnames(history).sort(), ['radaris.com', 'spokeo.com']);
});

test('historyHostnames returns empty array for empty / non-array input', () => {
  assert.deepEqual(historyHostnames([]), []);
  assert.deepEqual(historyHostnames(null), []);
  assert.deepEqual(historyHostnames(undefined), []);
});

test('historyHostnames skips entries with no hostname', () => {
  const history = [{ hostname: 'spokeo.com' }, { broker: 'X' }, { hostname: '' }];
  assert.deepEqual(historyHostnames(history), ['spokeo.com']);
});

// --- runSerpWatch orchestrator (deps injected) --------------------------------

const { runSerpWatch } = require('../lib/serp-watch');

const WATCH_PERSONS = [
  { firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', city: 'Austin', state: 'TX', email: 'jane@example.com' },
];
const WATCH_BROKERS = [
  { name: 'Spokeo',  optOutUrl: 'https://www.spokeo.com/optout' },
  { name: 'Radaris', optOutUrl: 'https://radaris.com/control/privacy' },
];

test('runSerpWatch reports a new domain in the result', async () => {
  const result = await runSerpWatch({}, WATCH_PERSONS, WATCH_BROKERS, {
    _readHistory: () => [{ hostname: 'spokeo.com' }],
    _runSerpScan: async () => ({
      total_brokers_appearing: 2,
      results: [
        { broker: 'Spokeo',  hostname: 'spokeo.com',  ranks: { ddg: 1, bing: null, google: null } },
        { broker: 'Radaris', hostname: 'radaris.com', ranks: { ddg: 2, bing: null, google: null } },
      ],
      blocked: [],
    }),
  });

  assert.equal('alerted' in result, false, 'no alerted flag (notifications were removed)');
  assert.deepEqual(result.diff.newDomains, ['radaris.com']);
});

test('runSerpWatch reports no new domains when nothing is new', async () => {
  const result = await runSerpWatch({}, WATCH_PERSONS, WATCH_BROKERS, {
    _readHistory: () => [{ hostname: 'spokeo.com' }, { hostname: 'radaris.com' }],
    _runSerpScan: async () => ({
      total_brokers_appearing: 1,
      results: [
        { broker: 'Spokeo', hostname: 'spokeo.com', ranks: { ddg: 1, bing: null, google: null } },
      ],
      blocked: [],
    }),
  });

  assert.equal('alerted' in result, false, 'no alerted flag (notifications were removed)');
  assert.deepEqual(result.diff.newDomains, []);
  assert.deepEqual(result.diff.goneDomains, ['radaris.com']);
});

test('runSerpWatch treats first-ever run (empty history) as all-new and alerts', async () => {
  const result = await runSerpWatch({}, WATCH_PERSONS, WATCH_BROKERS, {
    _readHistory: () => [],
    _runSerpScan: async () => ({
      total_brokers_appearing: 1,
      results: [{ broker: 'Spokeo', hostname: 'spokeo.com', ranks: { ddg: 1, bing: null, google: null } }],
      blocked: [],
    }),
  });

  assert.equal('alerted' in result, false, 'no alerted flag (notifications were removed)');
  assert.deepEqual(result.diff.newDomains, ['spokeo.com']);
});

test('runSerpWatch does not alert when the scan finds nothing', async () => {
  const result = await runSerpWatch({}, WATCH_PERSONS, WATCH_BROKERS, {
    _readHistory: () => [{ hostname: 'spokeo.com' }],
    _runSerpScan: async () => ({ total_brokers_appearing: 0, results: [], blocked: [] }),
  });

  assert.equal('alerted' in result, false, 'no alerted flag (notifications were removed)');
  assert.deepEqual(result.diff.newDomains, []);
});

test('runSerpWatch reads history BEFORE running the scan (snapshot is pre-scan)', async () => {
  const order = [];
  await runSerpWatch({}, WATCH_PERSONS, WATCH_BROKERS, {
    _readHistory: () => { order.push('read'); return [{ hostname: 'spokeo.com' }]; },
    _runSerpScan: async () => {
      order.push('scan');
      return { total_brokers_appearing: 1, results: [{ broker: 'Spokeo', hostname: 'spokeo.com', ranks: { ddg: 1, bing: null, google: null } }], blocked: [] };
    },
  });
  assert.deepEqual(order, ['read', 'scan'], 'history must be read before the scan appends to it');
});

test('runSerpWatch returns the scan summary on the result for callers to print', async () => {
  const summary = {
    total_brokers_appearing: 1,
    results: [{ broker: 'Radaris', hostname: 'radaris.com', ranks: { ddg: null, bing: 3, google: null } }],
    blocked: ['google'],
  };
  const result = await runSerpWatch({}, WATCH_PERSONS, WATCH_BROKERS, {
    _readHistory: () => [],
    _runSerpScan: async () => summary,
  });
  assert.equal(result.summary, summary);
});

// --- 2026-10-15 review: the report must say what was and was not checked ----

const { formatWatchReport } = require('../lib/serp-watch');

test('runSerpWatch passes --assist and the catalog sites to the scan', async () => {
  let seen = null;
  await runSerpWatch({}, [{ firstName: 'Jane', lastName: 'Doe' }], [], {
    _readHistory: () => [], assist: true, extraBrokers: [{ name: 'x', optOutUrl: 'https://x.example/' }],
    _runSerpScan: async (_c, _p, _b, o) => { seen = o; return { results: [], read: ['ddg', 'google'], unreadable: [] }; },
  });
  assert.equal(seen.assist, true);
  assert.equal(seen.extraBrokers.length, 1);
});

test('nothing counts as "gone" when an engine could not be read', async () => {
  const watch = await runSerpWatch({}, [], [], {
    _readHistory: () => [{ hostname: 'spokeo.com' }],
    _runSerpScan: async () => ({ results: [], read: ['ddg'], unreadable: [{ engine: 'google', label: 'Google', reason: 'bot check' }] }),
  });
  assert.deepEqual(watch.diff.goneDomains, []);
  assert.equal(watch.complete, false);
});

test('the report names every broker site showing the name, marking new ones', () => {
  const { lines, exitCode } = formatWatchReport({
    summary: { results: [{ broker: 'Spokeo', hostname: 'spokeo.com' }, { broker: 'Radaris', hostname: 'radaris.com' }], read: ['ddg', 'google'], unreadable: [] },
    diff: { newDomains: ['radaris.com'], goneDomains: [], stillPresent: ['spokeo.com'] },
    complete: true,
  });
  const out = lines.join('\n');
  assert.match(out, /radaris\.com \(Radaris\) - NEW/);
  assert.match(out, /spokeo\.com \(Spokeo\)/);
  assert.doesNotMatch(out, /spokeo\.com \(Spokeo\) - NEW/);
  assert.equal(exitCode, 0);
});

test('the report says which engines could not be read, and never "no broker sites" for them', () => {
  const { lines, exitCode } = formatWatchReport({
    summary: { results: [], read: ['ddg'], unreadable: [{ engine: 'google', label: 'Google', reason: 'bot check' }] },
    diff: { newDomains: [], goneDomains: [], stillPresent: [] },
    complete: false,
  });
  const out = lines.join('\n');
  assert.match(out, /Google could not be read: bot check/);
  assert.match(out, /only DuckDuckGo was read/i);
  assert.equal(exitCode, 0);
});

test('when no engine could be read the report says nothing was checked, exit 1', () => {
  const { lines, exitCode } = formatWatchReport({
    summary: { results: [], read: [], unreadable: [{ engine: 'ddg', label: 'DuckDuckGo', reason: 'HTTP 403' }, { engine: 'google', label: 'Google', reason: 'bot check' }] },
    diff: { newDomains: [], goneDomains: [], stillPresent: [] },
    complete: false,
  });
  assert.match(lines.join('\n'), /Nothing was checked/);
  assert.doesNotMatch(lines.join('\n'), /No .*broker/);
  assert.equal(exitCode, 1);
});

// Review 2026-10-15 (low): the "previous snapshot" was every host ever seen,
// so a site gone for months showed as "no longer showing your name" forever
// and a site that came back was never flagged NEW.
test('the previous snapshot is the latest scan only', () => {
  const { previousSnapshotHosts } = require('../lib/serp-watch');
  const history = [
    { personId: 'a', hostname: 'oldsite.example', scannedAt: '2026-08-01T10:00:00.000Z' },
    { personId: 'a', hostname: 'spokeo.com', scannedAt: '2026-10-01T10:00:00.000Z' },
    { personId: 'b', hostname: 'radaris.com', scannedAt: '2026-10-01T10:00:00.000Z' },
  ];
  assert.deepEqual(previousSnapshotHosts(history).sort(), ['radaris.com', 'spokeo.com']);
  assert.deepEqual(previousSnapshotHosts([]), []);
});

test('one scan stamps all its history entries with the same time', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'lib', 'serp-scan.js'), 'utf8');
  assert.doesNotMatch(src, /scannedAt: new Date\(\)\.toISOString\(\)/);
});
