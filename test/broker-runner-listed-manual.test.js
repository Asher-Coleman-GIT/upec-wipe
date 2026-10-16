/**
 * test/broker-runner-listed-manual.test.js
 *
 * manualAfterSearch: the tool searches for the member, and when a listing is
 * found it hands over the listing and the form link instead of submitting a
 * form it cannot complete (MyLife's embedded Jotform, 2026-10-11).
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const originalLoad = Module._load.bind(Module);

const logged = [];
let findResult = null;
let fillCalls = 0;
let gotoCalls = 0;
const configMock = {
  shouldSkip: () => null, saveCheckpoint: () => {}, stateKey: n => n,
  recordSuccess: () => {}, recordPendingConfirmation: () => {}, recordFailure: () => {}, recordAttempt: () => {}, recordManual: () => {},
};
Module._load = function (request, parent, isMain) {
  if (!parent?.filename?.includes('broker-runner')) return originalLoad(request, parent, isMain);
  if (request === './config') return configMock;
  if (request === './logger') return { logResult: (name, status, d) => logged.push({ name, status, detail: d }) };
  if (request === './forms') return {
    fillForm: async () => { fillCalls++; return { filled: [{ selector: '#f', value: 'Jane', kind: 'text' }], missed: [] }; },
    findListingUrl: async () => findResult,
  };
  if (request === './block-page') return { ...originalLoad(request, parent, isMain), checkPageBlockedDetail: async () => null };
  if (request === './timing') return { jitterSleep: async () => {} };
  return originalLoad(request, parent, isMain);
};
delete require.cache[require.resolve('../lib/broker-runner')];
const { configure, processBroker } = require('../lib/broker-runner');
Module._load = originalLoad;

const ctx = { newPage: async () => ({ goto: async () => { gotoCalls++; return { status: () => 200 }; }, close: async () => {}, locator: () => ({ first: () => ({ count: async () => 0 }) }) }) };
const B = { name: 'MyLife', method: 'search-form', manualAfterSearch: true, searchUrl: 'https://m.example/q', listingPattern: /x/, optOutUrl: 'https://m.example/form', formFields: { '#f': 'Jane' } };

test('a found listing is handed over as manual with the listing and the form link', async () => {
  logged.length = 0; fillCalls = 0; gotoCalls = 0; findResult = 'https://m.example/jane-doe-123.html';
  configure({ dryRun: false, preview: false, person: { country: 'US' } });
  await processBroker(ctx, B);
  const r = logged.at(-1);
  assert.equal(r.status, 'manual');
  assert.match(r.detail, /jane-doe-123/);
  assert.match(r.detail, /https:\/\/m\.example\/form/);
  assert.equal(fillCalls, 0, 'nothing is filled');
  assert.equal(gotoCalls, 0, 'the form page is not even opened');
});

test('no listing is still reported as not listed', async () => {
  logged.length = 0; findResult = null;
  configure({ dryRun: false, preview: false, person: { country: 'US' } });
  await processBroker(ctx, B);
  assert.equal(logged.at(-1).status, 'notFound');
});
