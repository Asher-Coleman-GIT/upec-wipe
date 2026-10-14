/**
 * test/broker-runner-start.test.js
 *
 * PeopleFinders (2026-10-14) shows its opt-out form only after a "Next"
 * button. A broker's optional startSelector is clicked once, before any field
 * is filled, when it is visible; nothing is typed by that click.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const Module = require('module');
const originalLoad = Module._load.bind(Module);

const logged = [];
const seq = [];
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
  if (request === './forms') return { fillForm: async () => (seq.push('fill'), 0) || ({ filled: [{ selector: 'input[name="first"]', value: 'Jane', kind: 'text' }], missed: [] }), findListingUrl: async () => null };
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
function makeContext(visibleStart = true) {
  return {
    newPage: async () => ({
      goto: async () => ({}),
      evaluate: async () => 'Your request was received.',
      waitForTimeout: async () => {},
      locator: (sel) => ({
        first: () => ({
          fill: async () => {},
          count: async () => 1,
          isVisible: async () => (sel === 'button:has-text("Next")' ? visibleStart : true),
          click: async () => { seq.push(`click ${sel}`); },
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

function clearAll() { logged.length = 0; seq.length = 0; for (const k of Object.keys(recorded)) recorded[k].length = 0; }

test('startSelector is clicked before the form is filled', async () => {
  clearAll();
  configure({ dryRun: true, person: { country: 'US' }, capsolver: null });
  await processBroker(makeContext(), { ...BROKER, startSelector: 'button:has-text("Next")', formFields: { '#a': 'x' } });
  assert.deepEqual(seq, ['click button:has-text("Next")', 'fill']);
});

test('a startSelector that is not visible is skipped and the fill still runs', async () => {
  clearAll();
  configure({ dryRun: true, person: { country: 'US' }, capsolver: null });
  await processBroker(makeContext(false), { ...BROKER, startSelector: 'button:has-text("Next")', formFields: { '#a': 'x' } });
  assert.deepEqual(seq, ['fill']);
});

test('PeopleFinders opens its opt-out form with the Next button', () => {
  const pf = require('../brokers').find(b => b.name === 'PeopleFinders');
  assert.equal(pf.startSelector, 'button:has-text("Next")');
});
