// test/broker-runner-blocked.test.js  (Module._load interception as in broker-runner-preview.test.js)
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const originalLoad = Module._load.bind(Module);
const logged = [];
let findImpl = async () => null;
let blockedReason = null;
const configMock = {
  shouldSkip: () => null, saveCheckpoint: () => {}, stateKey: n => n,
  recordSuccess: () => {}, recordPendingConfirmation: () => {}, recordFailure: () => {},
};
Module._load = function (request, parent, isMain) {
  if (!parent?.filename?.includes('broker-runner')) return originalLoad(request, parent, isMain);
  if (request === './config') return configMock;
  if (request === './logger') return { logResult: (name, status, detail) => logged.push({ name, status, detail }), results: { assistable: [] } };
  if (request === './forms') return { fillForm: async () => ({ filled: [{ selector: '#first', value: 'Jane', kind: 'text' }], missed: [] }), findListingUrl: (...a) => findImpl(...a) };
  if (request === './block-page') return { ...originalLoad(request, parent, isMain), checkPageBlockedDetail: async () => (blockedReason ? { reason: blockedReason, solvable: false } : null) };
  if (request === './timing') return { jitterSleep: async () => {} };
  return originalLoad(request, parent, isMain);
};
delete require.cache[require.resolve('../lib/broker-runner')];
const { configure, processBroker } = require('../lib/broker-runner');
Module._load = originalLoad;
const { BlockedPageError } = require('../lib/block-page');

const ctx = { newPage: async () => ({ goto: async () => ({ status: () => 200 }), close: async () => {}, locator: () => ({ first: () => ({ count: async () => 0 }) }) }) };
const SEARCH = { name: 'S', method: 'search-form', searchUrl: 'https://s.example/q', listingPattern: /x/, optOutUrl: 'https://s.example/optout', formFields: { '#first': 'Jane' } };
const DIRECT = { name: 'D', method: 'direct-form', optOutUrl: 'https://d.example/optout', formFields: { '#first': 'Jane' } };

test('a blocked search page is manual with the opt-out link, not notFound', async () => {
  logged.length = 0; blockedReason = null;
  findImpl = async () => { throw new BlockedPageError('blocked by bot protection'); };
  configure({ dryRun: true, preview: false, person: { country: 'US' } });
  await processBroker(ctx, SEARCH);
  assert.equal(logged[0].status, 'manual');
  assert.match(logged[0].detail, /bot protection/);
  assert.match(logged[0].detail, /https:\/\/s\.example\/optout/);
});
test('a search that fails to load is an error, not notFound', async () => {
  logged.length = 0; blockedReason = null;
  findImpl = async () => { throw new Error('net::ERR_NAME_NOT_RESOLVED'); };
  configure({ dryRun: true, preview: false, person: { country: 'US' } });
  await processBroker(ctx, SEARCH);
  assert.equal(logged[0].status, 'error');
  assert.match(logged[0].detail, /search page did not load/);
});
test('a blocked opt-out page is manual with the link', async () => {
  logged.length = 0; blockedReason = 'blocked by bot protection';
  configure({ dryRun: true, preview: false, person: { country: 'US' } });
  await processBroker(ctx, DIRECT);
  assert.equal(logged[0].status, 'manual');
  assert.match(logged[0].detail, /https:\/\/d\.example\/optout/);
});

test('a challenge page served with HTTP 503 is manual with the link, not an error', async () => {
  logged.length = 0; blockedReason = 'blocked by bot protection';
  configure({ dryRun: true, preview: false, person: { country: 'US' } });
  const ctx503 = { newPage: async () => ({ goto: async () => ({ status: () => 503 }), close: async () => {}, locator: () => ({ first: () => ({ count: async () => 0 }) }) }) };
  await processBroker(ctx503, DIRECT);
  assert.equal(logged[0].status, 'manual');
  assert.match(logged[0].detail, /https:\/\/d\.example\/optout/);
});

test('a plain 503 that is not a challenge page is still an error', async () => {
  logged.length = 0; blockedReason = null;
  configure({ dryRun: true, preview: false, person: { country: 'US' } });
  const ctx503 = { newPage: async () => ({ goto: async () => ({ status: () => 503 }), close: async () => {}, locator: () => ({ first: () => ({ count: async () => 0 }) }) }) };
  await processBroker(ctx503, DIRECT);
  assert.equal(logged[0].status, 'error');
});
