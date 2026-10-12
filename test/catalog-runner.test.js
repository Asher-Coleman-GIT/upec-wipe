// test/catalog-runner.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const originalLoad = Module._load.bind(Module);
const { catalogBrokersForPerson } = require('../lib/catalog');

const { watcherSource } = require('./helpers/watcher-source');
const watcherSrc = watcherSource();

test('the run appends catalog brokers after the 32, for each person', () => {
  assert.match(watcherSrc, /const personBrokers = \[\s*\.\.\.brokers\.forPerson\(person\),\s*\.\.\.catalogBrokersForPerson\(catalogRecords, person, explicitCatalogOpts\),/);
});

test('--list prints the catalog sites', () => {
  assert.match(watcherSrc, /Catalog sites/);
  assert.match(watcherSrc, /catalogSummary\(/);
});

test('the generic pass is told about every catalog domain', () => {
  assert.match(watcherSrc, /for \(const d of catalogDomains\(catalogRecords\)\) explicitHosts\.add\(d\);/);
});

// A reviewed catalog broker goes through processBroker with the same guards.
const logged = [];
let fillReport = { filled: [], missed: ['#first'] };
const configMock = {
  shouldSkip: () => null, saveCheckpoint: () => {}, stateKey: n => n,
  recordSuccess: () => {}, recordPendingConfirmation: () => {}, recordFailure: () => {},
};
Module._load = function (request, parent, isMain) {
  if (!parent?.filename?.includes('broker-runner')) return originalLoad(request, parent, isMain);
  if (request === './config') return configMock;
  if (request === './logger') return { logResult: (name, status, d) => logged.push({ name, status, detail: d }) };
  if (request === './forms') return { fillForm: async () => fillReport, findListingUrl: async () => null };
  if (request === './block-page') return { ...originalLoad(request, parent, isMain), checkPageBlockedDetail: async () => null };
  if (request === './timing') return { jitterSleep: async () => {} };
  return originalLoad(request, parent, isMain);
};
delete require.cache[require.resolve('../lib/broker-runner')];
const { configure, processBroker } = require('../lib/broker-runner');
Module._load = originalLoad;

const ctx = { newPage: async () => ({ goto: async () => ({ status: () => 200 }), close: async () => {}, locator: () => ({ first: () => ({ count: async () => 0 }) }) }) };
const REC = { domain: 'example-people.com', name: 'Example People', group: 'people-search', review: { state: 'reviewed', reviewedAt: '2026-10-13', definition: {
  method: 'direct-form', optOutUrl: 'https://example-people.com/opt-out', formFields: { '#first': '{firstName}', '#email': '{email}' } } } };

test('a catalog form that fills nothing is listed as manual, never submitted', async () => {
  logged.length = 0; fillReport = { filled: [], missed: ['#first', '#email'] };
  const [b] = catalogBrokersForPerson([REC], { firstName: 'Jane', email: 'alias@relay.example', country: 'US' });
  configure({ dryRun: false, preview: false, person: { country: 'US' } });
  await processBroker(ctx, b);
  assert.equal(logged.at(-1).status, 'manual');
  assert.match(logged.at(-1).detail, /form not recognised/);
});

test('a catalog form that fills is previewed like any broker', async () => {
  logged.length = 0; fillReport = { filled: [{ selector: '#first', value: 'Jane', kind: 'text' }], missed: [] };
  const [b] = catalogBrokersForPerson([REC], { firstName: 'Jane', email: 'alias@relay.example', country: 'US' });
  configure({ dryRun: true, preview: true, person: { country: 'US' } });
  await processBroker(ctx, b);
  assert.equal(logged.at(-1).status, 'preview');
});
