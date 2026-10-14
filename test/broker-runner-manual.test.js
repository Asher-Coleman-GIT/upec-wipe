/**
 * test/broker-runner-manual.test.js
 *
 * A site the run hands to the member (manual, or a CAPTCHA that could not be
 * solved) is recorded in state under its state key, so `upec-wipe manual`
 * can list it later. A dry run records nothing.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const Module = require('module');
const originalLoad = Module._load.bind(Module);

const logged = [];
const recorded = { success: [], pending: [], manual: [], failure: [] };
let captchaReturn = true;
let confirmReturn = { pending: false, snippet: '' };
// Controllable classify outcome - default 'success' to preserve the test's original intent
let classifyReturn = { outcome: 'success', snippet: 'Your request was received.' };

const configMock = {
  RECHECK_DAYS: 90,
  CONFIRM_RECHECK_DAYS: 14,
  lastOptOutDaysAgo: () => Infinity,
  shouldSkip: () => null,
  isPendingConfirmation: () => false,
  recordSuccess: (name, detail) => recorded.success.push({ name, detail }),
  recordPendingConfirmation: (name, detail) => recorded.pending.push({ name, detail }),
  recordManual: (name, detail) => recorded.manual.push({ name, detail }),
  recordFailure: (name, kind) => recorded.failure.push({ name, kind }),
  loadState: () => ({ optOuts: {} }),
  saveCheckpoint: () => {},
  stateKey: (brokerName) => `${brokerName}|key`,
};

function patchedLoad(request, parent, isMain) {
  if (!parent?.filename?.includes('broker-runner')) return originalLoad(request, parent, isMain);
  if (request === './config') return configMock;
  if (request === './logger') return {
    logResult: (name, status, detail) => logged.push({ name, status, detail }),
    STATUS_BUCKET: {},
  };
  if (request === './forms') return { fillForm: async () => ({ filled: [{ selector: 'input[name="first"]', value: 'Jane', kind: 'text' }], missed: [] }), findListingUrl: async () => null };
  if (request === './captcha') return { detectAndSolveCaptcha: async () => captchaReturn };
  if (request === './confirm') return { detectConfirmationRequired: async () => confirmReturn };
  if (request === './success') return { classifyPostSubmit: () => classifyReturn };
  if (request === './retry') return { withRetry: fn => fn() };
  if (request === './timing') return { jitterSleep: async () => {} };
  return originalLoad(request, parent, isMain);
}

Module._load = patchedLoad;
const brokerRunnerPath = require.resolve('../lib/broker-runner');
delete require.cache[brokerRunnerPath];
const { configure, processBroker } = require('../lib/broker-runner');
Module._load = originalLoad;

// Minimal Playwright stub - supports newPage / page.goto / page.locator / page.close / page.evaluate.
function makeContext() {
  return {
    newPage: async () => ({
      goto: async () => ({}),
      evaluate: async () => 'Your request was received.',
      locator: () => ({
        first: () => ({
          fill: async () => {},
          count: async () => 1,
          isVisible: async () => true,
          click: async () => {},
        }),
      }),
      close: async () => {},
    }),
  };
}

const BROKER = {
  name: 'TestPendingBroker',
  method: 'direct-form',
  optOutUrl: 'https://example.com/optout',
  submitSelector: 'button',
  formFields: {},
};

function clearAll() {
  logged.length = 0;
  for (const k of Object.keys(recorded)) recorded[k].length = 0;
  captchaReturn = true;
}

test('a manual broker is logged and recorded under its state key', async () => {
  clearAll();
  configure({ dryRun: false, person: { country: 'US' }, capsolver: null });
  await processBroker(makeContext(), { name: 'HandSite', method: 'manual', optOutUrl: 'https://hand.example/optout', notes: 'Search and pick your record: https://hand.example/optout' });
  assert.equal(logged[0].status, 'manual');
  assert.deepEqual(recorded.manual, [{ name: 'HandSite|key', detail: 'Search and pick your record: https://hand.example/optout' }]);
});

test('an unsolved CAPTCHA is recorded as manual with its link', async () => {
  clearAll();
  captchaReturn = false;
  configure({ dryRun: false, person: { country: 'US' }, capsolver: null });
  await processBroker(makeContext(), { ...BROKER, captchaLikely: true });
  assert.equal(logged.find(l => l.name === BROKER.name).status, 'captcha_failed');
  assert.equal(recorded.manual.length, 1);
  assert.equal(recorded.manual[0].name, `${BROKER.name}|key`);
  assert.match(recorded.manual[0].detail, /https:\/\/example\.com\/optout/);
});

test('a dry run records no manual entry', async () => {
  clearAll();
  configure({ dryRun: true, person: { country: 'US' }, capsolver: null });
  await processBroker(makeContext(), { name: 'HandSite', method: 'manual', optOutUrl: 'https://hand.example/optout' });
  assert.equal(logged[0].status, 'manual');
  assert.equal(recorded.manual.length, 0);
});
