/**
 * test/broker-runner-requires.test.js
 *
 * A broker whose form needs a detail the member did not give (requires: ['dob'])
 * goes to the manual list instead of submitting a form the site will reject.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const originalLoad = Module._load.bind(Module);

const logged = [];
let pages = 0;
const configMock = {
  shouldSkip: () => null, saveCheckpoint: () => {}, stateKey: n => n,
  recordSuccess: () => {}, recordPendingConfirmation: () => {}, recordFailure: () => {},
};
Module._load = function (request, parent, isMain) {
  if (!parent?.filename?.includes('broker-runner')) return originalLoad(request, parent, isMain);
  if (request === './config') return configMock;
  if (request === './logger') return { logResult: (name, status, d) => logged.push({ name, status, detail: d }) };
  if (request === './forms') return { fillForm: async () => ({ filled: [{ selector: '#f', value: 'x', kind: 'text' }], missed: [] }), findListingUrl: async () => null };
  if (request === './block-page') return { ...originalLoad(request, parent, isMain), checkPageBlockedDetail: async () => null };
  if (request === './timing') return { jitterSleep: async () => {} };
  return originalLoad(request, parent, isMain);
};
delete require.cache[require.resolve('../lib/broker-runner')];
const { configure, processBroker } = require('../lib/broker-runner');
Module._load = originalLoad;

const ctx = { newPage: async () => { pages++; return { goto: async () => ({ status: () => 200 }), close: async () => {}, locator: () => ({ first: () => ({ count: async () => 0 }) }) }; } };
const B = { name: 'PrivateRecords', method: 'direct-form', requires: ['dob'], optOutUrl: 'https://p.example/optout', formFields: { '#f': 'x' } };

test('missing date of birth: manual with the reason and the link, no page opened', async () => {
  logged.length = 0; pages = 0;
  configure({ dryRun: false, preview: false, person: { country: 'US' } });
  await processBroker(ctx, B);
  assert.equal(logged.at(-1).status, 'manual');
  assert.match(logged.at(-1).detail, /date of birth/);
  assert.match(logged.at(-1).detail, /https:\/\/p\.example\/optout/);
  assert.equal(pages, 0);
});

test('with a date of birth the broker runs normally', async () => {
  logged.length = 0;
  configure({ dryRun: true, preview: true, person: { country: 'US', dob: '1990-04-07' } });
  await processBroker(ctx, B);
  assert.equal(logged.at(-1).status, 'preview');
});
