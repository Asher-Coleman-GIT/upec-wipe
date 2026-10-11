// test/broker-runner-empty-form.test.js  (Module._load interception as in broker-runner-preview.test.js)
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const originalLoad = Module._load.bind(Module);
const logged = [];
let fillResult = { filled: [], missed: ['#first', '#last'] };
const configMock = {
  shouldSkip: () => null, saveCheckpoint: () => {}, stateKey: n => n,
  recordSuccess: () => {}, recordPendingConfirmation: () => {}, recordFailure: () => {},
};
Module._load = function (request, parent, isMain) {
  if (!parent?.filename?.includes('broker-runner')) return originalLoad(request, parent, isMain);
  if (request === './config') return configMock;
  if (request === './logger') return { logResult: (name, status, detail) => logged.push({ name, status, detail }) };
  if (request === './forms') return { fillForm: async () => fillResult, findListingUrl: async () => null };
  if (request === './block-page') return { ...originalLoad(request, parent, isMain), checkPageBlocked: async () => null };
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
