// test/broker-runner-empty-form.test.js  (Module._load interception as in broker-runner-preview.test.js)
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const originalLoad = Module._load.bind(Module);
const logged = [];
let fillResult = { filled: [], missed: ['#first', '#last'] };
let listingResult = null;
const configMock = {
  shouldSkip: () => null, saveCheckpoint: () => {}, stateKey: n => n,
  recordSuccess: () => {}, recordPendingConfirmation: () => {}, recordFailure: () => {},
};
Module._load = function (request, parent, isMain) {
  if (!parent?.filename?.includes('broker-runner')) return originalLoad(request, parent, isMain);
  if (request === './config') return configMock;
  if (request === './logger') return { logResult: (name, status, detail) => logged.push({ name, status, detail }) };
  if (request === './forms') return { fillForm: async () => fillResult, findListingUrl: async () => listingResult };
  if (request === './block-page') return { ...originalLoad(request, parent, isMain), checkPageBlockedDetail: async () => null };
  if (request === './timing') return { jitterSleep: async () => {} };
  return originalLoad(request, parent, isMain);
};
delete require.cache[require.resolve('../lib/broker-runner')];
const { configure, processBroker } = require('../lib/broker-runner');
Module._load = originalLoad;

const ctx = { newPage: async () => ({ goto: async () => ({ status: () => 200 }), close: async () => {}, locator: () => ({ first: () => ({ count: async () => 0 }) }) }) };
const BROKER = { name: 'E', method: 'direct-form', optOutUrl: 'https://e.example/optout', submitSelector: 'button', formFields: { '#first': 'Jane', '#last': 'Doe' } };

test('real run: nothing filled -> manual with the link, no submit', async () => {
  logged.length = 0; fillResult = { filled: [], missed: ['#first', '#last'] };
  configure({ dryRun: false, preview: false, person: { country: 'US' } });
  await processBroker(ctx, BROKER);
  assert.equal(logged[0].status, 'manual');
  assert.match(logged[0].detail, /form not recognised/);
  assert.match(logged[0].detail, /https:\/\/e\.example\/optout/);
});
test('real run: only a checkbox filled still counts as nothing filled', async () => {
  logged.length = 0; fillResult = { filled: [{ selector: '#agree', value: 'on', kind: 'checkbox' }], missed: ['#first'] };
  configure({ dryRun: false, preview: false, person: { country: 'US' } });
  await processBroker(ctx, BROKER);
  assert.equal(logged[0].status, 'manual');
});
test('preview: nothing filled says so instead of "would POST"', async () => {
  logged.length = 0; fillResult = { filled: [], missed: ['#first'] };
  configure({ dryRun: true, preview: true, person: { country: 'US' } });
  await processBroker(ctx, BROKER);
  assert.equal(logged[0].status, 'manual');
  assert.doesNotMatch(logged[0].detail, /would POST/);
});
test('preview: lists only the fields the tool filled, with checkbox state', async () => {
  logged.length = 0;
  fillResult = { filled: [{ selector: '#first', value: 'Jane', kind: 'text' }, { selector: '#agree', value: 'on', kind: 'checkbox' }], missed: ['#last'] };
  configure({ dryRun: true, preview: true, person: { country: 'US' } });
  await processBroker(ctx, BROKER);
  const e = logged.find(l => l.status === 'preview');
  assert.match(e.detail, /#first="Jane"/);
  assert.match(e.detail, /#agree=checked/);
  assert.match(e.detail, /not found: #last/);
  assert.match(e.detail, /would submit to https:\/\/e\.example\/optout/);
});

// Final review 2026-10-10: the listing URL only counts once it is really in a field.
function ctxWithUrlField({ present, fillOk }) {
  const urlField = {
    first: () => urlField,
    count: async () => (present ? 1 : 0),
    fill: async () => { if (!fillOk) throw new Error('fill failed'); },
  };
  return { newPage: async () => ({ goto: async () => ({ status: () => 200 }), close: async () => {}, locator: () => urlField }) };
}
const SEARCH = { name: 'S', method: 'search-form', searchUrl: 'https://s.example/q', listingPattern: /x/, optOutUrl: 'https://s.example/optout', submitSelector: 'button', formFields: { 'input[name="email"]': 'jane@example.com' } };

test('a listing URL with no field to put it in does not count as filled', async () => {
  logged.length = 0; listingResult = 'https://s.example/p/1'; fillResult = { filled: [], missed: ['input[name="email"]'] };
  configure({ dryRun: false, preview: false, person: { country: 'US' } });
  await processBroker(ctxWithUrlField({ present: false, fillOk: false }), SEARCH);
  assert.equal(logged.at(-1).status, 'manual');
  assert.match(logged.at(-1).detail, /form not recognised/);
});

test('a listing URL that was entered counts, and preview shows it', async () => {
  logged.length = 0; listingResult = 'https://s.example/p/1'; fillResult = { filled: [], missed: ['input[name="email"]'] };
  configure({ dryRun: true, preview: true, person: { country: 'US' } });
  await processBroker(ctxWithUrlField({ present: true, fillOk: true }), SEARCH);
  const e = logged.find(l => l.status === 'preview');
  assert.ok(e, 'preview, not manual');
  assert.match(e.detail, /listing="https:\/\/s\.example\/p\/1"/);
  listingResult = null;
});
