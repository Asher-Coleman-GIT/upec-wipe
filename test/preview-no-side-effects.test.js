/**
 * test/preview-no-side-effects.test.js
 *
 * F-D fact-check: `upec-wipe preview` (dry-run) still called CapSolver on CAPTCHA
 * brokers (spends credit, a direct connection) and opened manual pages in the
 * everyday browser (no proxy) at the end. A dry run does neither.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function loadRunner(captchaCalls, logged) {
  const originalLoad = Module._load.bind(Module);
  Module._load = function (request, parent, isMain) {
    if (!parent?.filename?.includes('broker-runner')) return originalLoad(request, parent, isMain);
    if (request === './config') return {
      RECHECK_DAYS: 90, CONFIRM_RECHECK_DAYS: 14, lastOptOutDaysAgo: () => Infinity, shouldSkip: () => null,
      isPendingConfirmation: () => false, recordSuccess: () => {}, recordPendingConfirmation: () => {},
      recordFailure: () => {}, loadState: () => ({ optOuts: {} }), saveCheckpoint: () => {}, stateKey: (b) => b,
    };
    if (request === './logger') return { logResult: (n, s) => logged.push(s), STATUS_BUCKET: {} };
    if (request === './forms') return { fillForm: async () => ({ filled: [{ selector: 'input[name="first"]', value: 'Jane', kind: 'text' }], missed: [] }), findListingUrl: async () => null };
    if (request === './captcha') return { detectAndSolveCaptcha: async () => { captchaCalls.n++; return true; } };
    if (request === './retry') return { withRetry: (fn) => fn() };
    if (request === './timing') return { jitterSleep: async () => {} };
    return originalLoad(request, parent, isMain);
  };
  const p = require.resolve('../lib/broker-runner');
  delete require.cache[p];
  try { return require('../lib/broker-runner'); } finally { Module._load = originalLoad; delete require.cache[p]; }
}

const context = { newPage: async () => ({
  goto: async () => ({ status: () => 200 }),
  locator: () => ({ first: () => ({ fill: async () => {}, count: async () => 1, isVisible: async () => true, click: async () => {} }) }),
  evaluate: async () => [],
  close: async () => {},
}) };
const person = { firstName: 'T', lastName: 'U', email: 't@example.com', country: 'US' };
const broker = { name: 'CapBroker', method: 'direct-form', optOutUrl: 'https://example.com/o', captchaLikely: true, formFields: {} };

test('preview never calls CapSolver on a CAPTCHA broker, and still dumps the form', async () => {
  const calls = { n: 0 }, logged = [];
  const runner = loadRunner(calls, logged);
  runner.configure({ dryRun: true, preview: true, person, capsolver: { apiKey: 'CAP-REALKEY' } });
  await runner.processBrokerWithPerson(context, broker, person);
  assert.equal(calls.n, 0, 'no CapSolver call in preview');
  assert.ok(logged.includes('preview'), `preview line logged: ${logged}`);
});

test('a real run still solves the CAPTCHA', async () => {
  const calls = { n: 0 }, logged = [];
  const runner = loadRunner(calls, logged);
  runner.configure({ dryRun: false, person, capsolver: { apiKey: 'CAP-REALKEY' } });
  await runner.processBrokerWithPerson(context, broker, person);
  assert.equal(calls.n, 1);
});

test('watcher opens manual pages in the everyday browser only on a real run', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'watcher.js'), 'utf8');
  const block = src.slice(src.indexOf('// Open manual-required sites'), src.indexOf('openInBrowser(manualUrls);') + 30);
  assert.match(block, /if \(manualUrls\.length > 0 && !DRY_RUN\)/);
});
