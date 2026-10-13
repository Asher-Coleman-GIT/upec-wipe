/**
 * test/broker-runner-assist.test.js
 *
 * --assist: a solvable challenge on the search or opt-out page waits for the
 * member, then the normal flow continues. Hard blocks and timeouts stay manual.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const originalLoad = Module._load.bind(Module);

const logged = [];
let detail = null;          // what the opt-out page reads as
let waitResult = true;
let waitCalls = 0;
let findSeq = [];
const configMock = {
  shouldSkip: () => null, saveCheckpoint: () => {}, stateKey: n => n,
  recordSuccess: () => {}, recordPendingConfirmation: () => {}, recordFailure: () => {},
};
const assistable = [];
Module._load = function (request, parent, isMain) {
  if (!parent?.filename?.includes('broker-runner')) return originalLoad(request, parent, isMain);
  if (request === './config') return configMock;
  if (request === './logger') return { logResult: (name, status, d) => logged.push({ name, status, detail: d }), results: { assistable } };
  if (request === './forms') return {
    fillForm: async () => ({ filled: [{ selector: '#first', value: 'Jane', kind: 'text' }], missed: [] }),
    findListingUrl: async () => { const n = findSeq.shift(); if (n instanceof Error) throw n; return n === undefined ? null : n; },
  };
  if (request === './block-page') return { ...originalLoad(request, parent, isMain), checkPageBlockedDetail: async () => detail };
  if (request === './assist') return { waitForHumanCheck: async () => { waitCalls++; if (waitResult) detail = null; return waitResult; } };
  if (request === './timing') return { jitterSleep: async () => {} };
  return originalLoad(request, parent, isMain);
};
delete require.cache[require.resolve('../lib/broker-runner')];
const { configure, processBroker } = require('../lib/broker-runner');
Module._load = originalLoad;
const { BlockedPageError } = require('../lib/block-page');

const ctx = { newPage: async () => ({ goto: async () => ({ status: () => 403 }), close: async () => {}, locator: () => ({ first: () => ({ count: async () => 0 }) }) }) };
const DIRECT = { name: 'D', method: 'direct-form', optOutUrl: 'https://d.example/optout', formFields: { '#first': 'Jane' } };
const SEARCH = { name: 'S', method: 'search-form', searchUrl: 'https://s.example/q', listingPattern: /x/, optOutUrl: 'https://s.example/optout', formFields: { '#first': 'Jane' } };
const CHALLENGE = { reason: 'blocked by bot protection', solvable: true };
const HARD = { reason: 'blocked by bot protection', solvable: false };
function reset(over = {}) { logged.length = 0; waitCalls = 0; waitResult = true; detail = null; findSeq = []; Object.assign(module.exports, over); }

test('assist: a cleared challenge on the opt-out page continues to the form', async () => {
  reset(); detail = { ...CHALLENGE };
  configure({ dryRun: true, preview: true, assist: true, person: { country: 'US' } });
  await processBroker(ctx, DIRECT);
  assert.equal(waitCalls, 1);
  assert.equal(logged.at(-1).status, 'preview');
});

test('assist: a challenge not completed in time stays manual and says so', async () => {
  reset(); detail = { ...CHALLENGE }; waitResult = false;
  configure({ dryRun: true, preview: true, assist: true, person: { country: 'US' } });
  await processBroker(ctx, DIRECT);
  assert.equal(logged.at(-1).status, 'manual');
  assert.match(logged.at(-1).detail, /not completed in time/);
  assert.match(logged.at(-1).detail, /https:\/\/d\.example\/optout/);
});

test('assist: a hard block does not wait', async () => {
  reset(); detail = { ...HARD };
  configure({ dryRun: true, preview: true, assist: true, person: { country: 'US' } });
  await processBroker(ctx, DIRECT);
  assert.equal(waitCalls, 0);
  assert.equal(logged.at(-1).status, 'manual');
});

test('without assist a challenge is manual and nothing waits', async () => {
  reset(); detail = { ...CHALLENGE };
  configure({ dryRun: true, preview: true, assist: false, person: { country: 'US' } });
  await processBroker(ctx, DIRECT);
  assert.equal(waitCalls, 0);
  assert.equal(logged.at(-1).status, 'manual');
});

test('assist: a cleared challenge on the search page retries the search once', async () => {
  reset();
  findSeq = [new BlockedPageError('blocked by bot protection', { solvable: true }), 'https://s.example/p/1'];
  configure({ dryRun: true, preview: true, assist: true, person: { country: 'US' } });
  await processBroker(ctx, SEARCH);
  assert.equal(waitCalls, 1);
  assert.equal(logged.at(-1).status, 'preview');
});

test('assist: a hard block on the search page stays manual without waiting', async () => {
  reset();
  findSeq = [new BlockedPageError('blocked by bot protection', { solvable: false })];
  configure({ dryRun: true, preview: true, assist: true, person: { country: 'US' } });
  await processBroker(ctx, SEARCH);
  assert.equal(waitCalls, 0);
  assert.equal(logged.at(-1).status, 'manual');
});

test('assist: a search interrupted by the site\'s own post-check redirect is tried again', async () => {
  reset();
  const interrupted = new Error('page.goto: Navigation to "https://s.example/q" is interrupted by another navigation to "https://s.example/q?__cf_chl_tk=x"');
  findSeq = [new BlockedPageError('blocked by bot protection', { solvable: true }), interrupted, 'https://s.example/p/1'];
  configure({ dryRun: true, preview: true, assist: true, person: { country: 'US' } });
  await processBroker(ctx, SEARCH);
  assert.equal(logged.at(-1).status, 'preview', JSON.stringify(logged.at(-1)));
});

test('a solvable check met without --assist is noted for the summary hint', async () => {
  assert.ok(assistable.length >= 1, 'the no-assist challenge test above notes its broker');
});
