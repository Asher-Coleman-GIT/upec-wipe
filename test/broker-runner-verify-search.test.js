/**
 * test/broker-runner-verify-search.test.js
 *
 * Spokeo, 2026-10-15: the run's listing search used a link pattern that
 * matched nothing, so every run said "Not listed". A search-form broker with
 * verifySearch now finds the listing through the same card search as verify
 * (name + city in a result card), with --assist passed through.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const originalLoad = Module._load.bind(Module);

const logged = [];
let searchResult = null;
const searches = [];
let oldSearches = 0;
Module._load = function (request, parent, isMain) {
  if (!parent?.filename?.includes('broker-runner')) return originalLoad(request, parent, isMain);
  if (request === './config') return {
    shouldSkip: () => null, saveCheckpoint: () => {}, stateKey: n => n,
    recordSuccess: () => {}, recordPendingConfirmation: () => {}, recordFailure: () => {}, recordManual: () => {},
  };
  if (request === './logger') return { logResult: (name, status, d) => logged.push({ name, status, detail: d }), results: { assistable: [] } };
  if (request === './forms') return {
    fillForm: async () => ({ filled: [{ selector: '#e', value: 'x', kind: 'text' }], missed: [] }),
    findListingUrl: async () => { oldSearches++; return null; },
  };
  if (request === './verify-search') return {
    searchListing: async (_page, broker, person, opts) => {
      searches.push({ name: broker.name, person, assist: opts.assist });
      if (searchResult instanceof Error) throw searchResult;
      return searchResult;
    },
  };
  if (request === './block-page') return { ...originalLoad(request, parent, isMain), checkPageBlockedDetail: async () => null };
  if (request === './timing') return { jitterSleep: async () => {} };
  return originalLoad(request, parent, isMain);
};
delete require.cache[require.resolve('../lib/broker-runner')];
const { createBrokerRunner } = require('../lib/broker-runner');
Module._load = originalLoad;
const { BlockedPageError } = require('../lib/block-page');

const ctx = { newPage: async () => ({ goto: async () => ({ status: () => 200 }), close: async () => {}, url: () => 'https://s.example/optout', locator: () => ({ first: () => ({ count: async () => 0 }) }) }) };
const SPOKEO = {
  name: 'S', method: 'search-form', searchUrl: 'https://s.example/search', listingPattern: /never/,
  verifySearch: { url: 'https://s.example/Jane-Doe/Texas/Austin', cardSelector: '.card' },
  optOutUrl: 'https://s.example/optout', formFields: { '#e': 'x' },
};
const PERSON = { firstName: 'Jane', lastName: 'Doe', city: 'Austin', state: 'TX', country: 'US' };
function reset() { logged.length = 0; searches.length = 0; oldSearches = 0; searchResult = null; }

test('the run searches through verifySearch (not the old pattern) and passes --assist', async () => {
  reset(); searchResult = null;
  await createBrokerRunner({ dryRun: true, preview: true, assist: true, person: PERSON }).processBroker(ctx, SPOKEO);
  assert.deepEqual(searches, [{ name: 'S', person: PERSON, assist: true }]);
  assert.equal(oldSearches, 0);
  assert.equal(logged.at(-1).status, 'notFound');
});

test('a card match goes on to the opt-out form', async () => {
  reset(); searchResult = 'https://s.example/Jane-Doe/Texas/Austin/p1';
  await createBrokerRunner({ dryRun: true, preview: true, person: PERSON }).processBroker(ctx, SPOKEO);
  assert.equal(logged.at(-1).status, 'preview');
});

test('a bot check the member did not clear is manual, with the link', async () => {
  reset(); searchResult = new BlockedPageError('blocked by bot protection', { solvable: true });
  await createBrokerRunner({ dryRun: true, preview: true, person: PERSON }).processBroker(ctx, SPOKEO);
  assert.equal(logged.at(-1).status, 'manual');
  assert.match(logged.at(-1).detail, /s\.example\/optout/);
});

test('a changed layout is an error, never "Not listed"', async () => {
  reset(); searchResult = new Error('no result cards found - the page layout may have changed');
  await createBrokerRunner({ dryRun: true, preview: true, person: PERSON }).processBroker(ctx, SPOKEO);
  assert.equal(logged.at(-1).status, 'error');
});
