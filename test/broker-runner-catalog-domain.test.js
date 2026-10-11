/**
 * test/broker-runner-catalog-domain.test.js
 *
 * Final review #8: a catalog site whose opt-out page now lands on another
 * domain is not filled; it is handed over as manual.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const originalLoad = Module._load.bind(Module);

const logged = [];
let fills = 0;
let landed = 'https://acme.com/optout';
const configMock = {
  shouldSkip: () => null, saveCheckpoint: () => {}, stateKey: n => n,
  recordSuccess: () => {}, recordPendingConfirmation: () => {}, recordFailure: () => {},
};
Module._load = function (request, parent, isMain) {
  if (!parent?.filename?.includes('broker-runner')) return originalLoad(request, parent, isMain);
  if (request === './config') return configMock;
  if (request === './logger') return { logResult: (name, status, d) => logged.push({ name, status, detail: d }) };
  if (request === './forms') return { fillForm: async () => { fills++; return { filled: [{ selector: '#e', value: 'x', kind: 'text' }], missed: [] }; }, findListingUrl: async () => null };
  if (request === './block-page') return { ...originalLoad(request, parent, isMain), checkPageBlockedDetail: async () => null };
  if (request === './timing') return { jitterSleep: async () => {} };
  return originalLoad(request, parent, isMain);
};
delete require.cache[require.resolve('../lib/broker-runner')];
const { configure, processBroker } = require('../lib/broker-runner');
Module._load = originalLoad;

const ctx = { newPage: async () => ({ url: () => landed, goto: async () => ({ status: () => 200 }), close: async () => {}, locator: () => ({ first: () => ({ count: async () => 0 }) }) }) };
const B = { name: 'Acme', source: 'catalog', domain: 'acme.com', formHosts: ['onetrust.com'], method: 'direct-form', optOutUrl: 'https://acme.com/optout', formFields: { '#e': 'a@relay.example' } };

test('a catalog page that lands off its domain is manual and nothing is filled', async () => {
  logged.length = 0; fills = 0; landed = 'https://lookalike-broker.net/collect';
  configure({ dryRun: false, preview: false, person: { country: 'US' } });
  await processBroker(ctx, B);
  assert.equal(logged.at(-1).status, 'manual');
  assert.match(logged.at(-1).detail, /now goes to lookalike-broker\.net/);
  assert.equal(fills, 0);
});

test('its own domain and its recorded form host are filled as usual', async () => {
  for (const u of ['https://www.acme.com/optout', 'https://privacyportal.onetrust.com/webform/1']) {
    logged.length = 0; fills = 0; landed = u;
    configure({ dryRun: true, preview: true, person: { country: 'US' } });
    await processBroker(ctx, B);
    assert.equal(logged.at(-1).status, 'preview', u);
    assert.equal(fills, 1);
  }
});

test('explicit brokers are not affected', async () => {
  logged.length = 0; fills = 0; landed = 'https://elsewhere.example/x';
  configure({ dryRun: true, preview: true, person: { country: 'US' } });
  await processBroker(ctx, { ...B, source: undefined, domain: undefined });
  assert.equal(logged.at(-1).status, 'preview');
});
