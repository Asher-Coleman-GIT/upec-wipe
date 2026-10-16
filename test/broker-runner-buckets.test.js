/**
 * test/broker-runner-buckets.test.js
 *
 * Verifies the correct outcome-bucketing behaviour in processBroker:
 *
 *   - notFound: logs 'notFound', does NOT call recordSuccess
 *   - unknown post-submit: logs 'unverified', does NOT call recordSuccess
 *   - success post-submit: logs 'success', DOES call recordSuccess
 *   - failure post-submit: logs 'error', does NOT call recordSuccess
 *
 * Uses the Module._load interception pattern from the other broker-runner tests.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const Module = require('module');
const originalLoad = Module._load.bind(Module);

const logged = [];
const recorded = { success: [], failure: [], attempt: [], pending: [] };

// Controllable classify return - default is 'unknown' (neither success nor failure)
let classifyReturn = { outcome: 'unknown', snippet: '' };

// Controllable email-confirmation detection - default: no confirmation asked.
let confirmReturn = { pending: false, snippet: '' };

// Controllable page body for post-submit read
let pageBody = 'Some generic page text with no confirmation';

const configMock = {
  RECHECK_DAYS: 90,
  CONFIRM_RECHECK_DAYS: 14,
  lastOptOutDaysAgo: () => Infinity,
  shouldSkip: () => null,
  isPendingConfirmation: () => false,
  recordSuccess: (name, detail) => recorded.success.push({ name, detail }),
  recordPendingConfirmation: (name, snippet) => recorded.pending.push({ name, snippet }),
  recordManual: () => {},
  recordFailure: (name, kind) => recorded.failure.push({ name, kind }),
  recordAttempt: (name, kind) => recorded.attempt.push({ name, kind }),
  loadState: () => ({ optOuts: {} }),
  saveCheckpoint: () => {},
  stateKey: (brokerName) => brokerName,
};

function patchedLoad(request, parent, isMain) {
  if (!parent?.filename?.includes('broker-runner')) return originalLoad(request, parent, isMain);
  if (request === './config') return configMock;
  if (request === './logger') return {
    logResult: (name, status, detail) => logged.push({ name, status, detail }),
    STATUS_BUCKET: {},
  };
  if (request === './forms') return {
    fillForm: async () => ({ filled: [{ selector: 'input[name="first"]', value: 'Jane', kind: 'text' }], missed: [] }),
    findListingUrl: async () => null,  // will be overridden per-test via broker.method
  };
  if (request === './captcha') return { detectAndSolveCaptcha: async () => true };
  if (request === './confirm') return { detectConfirmationRequired: async () => confirmReturn };
  if (request === './success') return { classifyPostSubmit: () => classifyReturn };
  if (request === './retry') return { withRetry: fn => fn() };
  if (request === './timing') return { jitterSleep: async () => {} };
  return originalLoad(request, parent, isMain);
}

Module._load = patchedLoad;
const brokerRunnerPath = require.resolve('../lib/broker-runner');
delete require.cache[brokerRunnerPath];
const { configure, processBrokerWithPerson } = require('../lib/broker-runner');
Module._load = originalLoad;

// ── Helpers ───────────────────────────────────────────────────────────────────

function clearAll() {
  logged.length = 0;
  recorded.success.length = 0;
  recorded.failure.length = 0;
  recorded.attempt.length = 0;
  recorded.pending.length = 0;
  confirmReturn = { pending: false, snippet: '' };
}

const PERSON = { firstName: 'Test', lastName: 'User', email: 'test@example.com', country: 'US' };

// Context whose page body is controllable
function makeContext() {
  return {
    newPage: async () => ({
      goto: async () => {},
      locator: (sel) => ({
        first: () => ({
          fill: async () => {},
          count: async () => 1,
          isVisible: async () => true,
          click: async () => {},
        }),
      }),
      evaluate: async (fn) => {
        // page.evaluate is used in two ways:
        //   1. () => document.body?.innerText || '' (post-submit body read)
        //   2. () => [...document.querySelectorAll(...)] (preview field dump)
        // We return pageBody for the innerText call, empty array otherwise.
        return pageBody;
      },
      close: async () => {},
    }),
  };
}

const DIRECT_BROKER = {
  name: 'BucketTestBroker',
  method: 'direct-form',
  optOutUrl: 'https://example.com/optout',
  submitSelector: 'button[type="submit"]',
  formFields: {},
};

// A search-form broker whose findListingUrl returns null (not found)
const SEARCH_BROKER = {
  name: 'SearchTestBroker',
  method: 'search-form',
  searchUrl: 'https://example.com/search',
  optOutUrl: 'https://example.com/optout',
  formFields: {},
};

// ── Module that intercepts findListingUrl for the notFound tests ──────────────
// We need the forms mock to return null for findListingUrl to trigger notFound.
// The patchedLoad above already returns null for findListingUrl, so SEARCH_BROKER
// with method='search-form' will hit the notFound branch.

// ── notFound tests ────────────────────────────────────────────────────────────

test('notFound: logResult called with status notFound', async () => {
  clearAll();
  configure({ dryRun: false, person: PERSON, capsolver: null });

  await processBrokerWithPerson(makeContext(), SEARCH_BROKER, PERSON);

  const entry = logged.find(l => l.name === SEARCH_BROKER.name);
  assert.ok(entry, 'logResult should have been called');
  assert.equal(entry.status, 'notFound');
});

test('notFound: recordSuccess is NOT called', async () => {
  clearAll();
  configure({ dryRun: false, person: PERSON, capsolver: null });

  await processBrokerWithPerson(makeContext(), SEARCH_BROKER, PERSON);

  assert.equal(
    recorded.success.length,
    0,
    'recordSuccess must NOT be called for a notFound outcome'
  );
});

// `upec-wipe list` must not call a searched broker "never run".
test('notFound: the attempt is recorded as not_found', async () => {
  clearAll();
  configure({ dryRun: false, person: PERSON, capsolver: null });

  await processBrokerWithPerson(makeContext(), SEARCH_BROKER, PERSON);

  assert.deepEqual(recorded.attempt, [{ name: SEARCH_BROKER.name, kind: 'not_found' }]);
});

// ── unknown post-submit tests ─────────────────────────────────────────────────

test('unknown post-submit: logResult called with status unverified', async () => {
  clearAll();
  classifyReturn = { outcome: 'unknown', snippet: '' };
  configure({ dryRun: false, person: PERSON, capsolver: null });

  await processBrokerWithPerson(makeContext(), DIRECT_BROKER, PERSON);

  const entry = logged.find(l => l.name === DIRECT_BROKER.name);
  assert.ok(entry, 'logResult should have been called');
  assert.equal(entry.status, 'unverified', `expected status "unverified" but got "${entry.status}"`);
});

test('unknown post-submit: recordSuccess is NOT called', async () => {
  clearAll();
  classifyReturn = { outcome: 'unknown', snippet: '' };
  configure({ dryRun: false, person: PERSON, capsolver: null });

  await processBrokerWithPerson(makeContext(), DIRECT_BROKER, PERSON);

  assert.equal(
    recorded.success.length,
    0,
    'recordSuccess must NOT be called for an unknown/unverified outcome'
  );
});

test('unknown post-submit: the attempt is recorded as unverified', async () => {
  clearAll();
  classifyReturn = { outcome: 'unknown', snippet: '' };
  configure({ dryRun: false, person: PERSON, capsolver: null });

  await processBrokerWithPerson(makeContext(), DIRECT_BROKER, PERSON);

  assert.deepEqual(recorded.attempt, [{ name: DIRECT_BROKER.name, kind: 'unverified' }]);
});

// ── success post-submit tests ─────────────────────────────────────────────────

test('success post-submit: logResult called with status success', async () => {
  clearAll();
  classifyReturn = { outcome: 'success', snippet: 'Your request was received.' };
  configure({ dryRun: false, person: PERSON, capsolver: null });

  await processBrokerWithPerson(makeContext(), DIRECT_BROKER, PERSON);

  const entry = logged.find(l => l.name === DIRECT_BROKER.name);
  assert.ok(entry, 'logResult should have been called');
  assert.equal(entry.status, 'success');
});

test('success post-submit: recordSuccess IS called', async () => {
  clearAll();
  classifyReturn = { outcome: 'success', snippet: 'Your request was received.' };
  configure({ dryRun: false, person: PERSON, capsolver: null });

  await processBrokerWithPerson(makeContext(), DIRECT_BROKER, PERSON);

  assert.equal(recorded.success.length, 1, 'recordSuccess must be called exactly once');
  assert.equal(recorded.success[0].name, DIRECT_BROKER.name);
});

// ── failure post-submit tests ─────────────────────────────────────────────────

test('failure post-submit: logResult called with status error', async () => {
  clearAll();
  classifyReturn = { outcome: 'failure', snippet: 'This field is required.' };
  configure({ dryRun: false, person: PERSON, capsolver: null });

  await processBrokerWithPerson(makeContext(), DIRECT_BROKER, PERSON);

  const entry = logged.find(l => l.name === DIRECT_BROKER.name);
  assert.ok(entry, 'logResult should have been called');
  assert.equal(entry.status, 'error');
});

test('failure post-submit: recordSuccess is NOT called', async () => {
  clearAll();
  classifyReturn = { outcome: 'failure', snippet: 'This field is required.' };
  configure({ dryRun: false, person: PERSON, capsolver: null });

  await processBrokerWithPerson(makeContext(), DIRECT_BROKER, PERSON);

  assert.equal(
    recorded.success.length,
    0,
    'recordSuccess must NOT be called for a failure outcome'
  );
});

// B13: a dead HTTP status (404/410/5xx) on the opt-out URL must short-circuit
// BEFORE the form is filled/submitted, logging 'error' (not success/unverified).
function makeContextWithStatus(statusCode) {
  return {
    newPage: async () => ({
      goto: async () => ({ status: () => statusCode }),
      locator: () => ({ first: () => ({ fill: async () => {}, count: async () => 1, isVisible: async () => true, click: async () => {} }) }),
      evaluate: async () => pageBody,
      close: async () => {},
    }),
  };
}

test('B13: opt-out URL returning HTTP 404 short-circuits to error, no success', async () => {
  clearAll();
  classifyReturn = { outcome: 'success', snippet: 'request received' }; // would falsely "succeed" if not short-circuited
  configure({ dryRun: false, person: PERSON, capsolver: null });

  await processBrokerWithPerson(makeContextWithStatus(404), DIRECT_BROKER, PERSON);

  const entry = logged.find(l => l.name === DIRECT_BROKER.name);
  assert.ok(entry, 'a result should be logged');
  assert.equal(entry.status, 'error', 'a 404 opt-out page must log error');
  assert.match(entry.detail, /HTTP 404/);
  assert.equal(recorded.success.length, 0, 'must NOT record success for a 404 page');
  assert.equal(recorded.failure.length, 1, 'must record a failure for a 404 page');
});

test('B13: HTTP 200 does NOT short-circuit (normal flow continues)', async () => {
  clearAll();
  classifyReturn = { outcome: 'success', snippet: 'request received' };
  configure({ dryRun: false, person: PERSON, capsolver: null });

  await processBrokerWithPerson(makeContextWithStatus(200), DIRECT_BROKER, PERSON);

  const entry = logged.find(l => l.name === DIRECT_BROKER.name);
  assert.ok(entry, 'a result should be logged');
  assert.notEqual(entry.detail, undefined);
  assert.ok(!/HTTP 404|HTTP 5/.test(entry.detail || ''), 'a 200 page must not be treated as a dead HTTP status');
});

// Review 2026-10-15: "Invalid email. Please check your email address" read as
// "check your email" (pending) and skipped the broker for 14 days.
test('failure wording wins over a confirmation phrase on the same page', async () => {
  clearAll();
  confirmReturn = { pending: true, snippet: 'Please check your email address and try again.' };
  classifyReturn = { outcome: 'failure', snippet: 'Invalid email.' };
  configure({ dryRun: false, person: PERSON, capsolver: null });

  await processBrokerWithPerson(makeContext(), DIRECT_BROKER, PERSON);

  assert.equal(logged.find(l => l.name === DIRECT_BROKER.name).status, 'error');
  assert.deepEqual(recorded.failure, [{ name: DIRECT_BROKER.name, kind: 'error' }]);
});

// Review 2026-10-15: with no visible submit button nothing was clicked, but the
// form page itself was classified, and its instructions could read as success.
test('no visible submit button hands the broker over by hand and classifies nothing', async () => {
  clearAll();
  classifyReturn = { outcome: 'success', snippet: 'Your request has been received.' };
  configure({ dryRun: false, person: PERSON, capsolver: null });
  const ctx = makeContext();
  const newPage = ctx.newPage;
  ctx.newPage = async () => {
    const p = await newPage();
    const base = p.locator;
    p.locator = (sel) => (sel.includes('submit') ? { first: () => ({ count: async () => 0, isVisible: async () => false, click: async () => { throw new Error('must not click'); } }) } : base(sel));
    return p;
  };

  await processBrokerWithPerson(ctx, DIRECT_BROKER, PERSON);

  const entry = logged.find(l => l.name === DIRECT_BROKER.name);
  assert.equal(entry.status, 'manual');
  assert.match(entry.detail, /submit button was not found/);
  assert.equal(recorded.success.length, 0);
});

// Review 2026-10-15: confirmation pages echo what was submitted; the excerpt
// went unredacted into logs/run-*.json, the audit file and state.json.
test('page excerpts lose the person\'s details and the alias before they are logged or saved', async () => {
  clearAll();
  const alias = 'relay.abc@alias.example';
  confirmReturn = { pending: true, snippet: `Opt-out for Test User of Exampleton, TX 00000: we sent a confirmation email to ${alias}.` };
  const person = { ...PERSON, city: 'Exampleton', zip: '00000' };
  configure({ dryRun: false, person, capsolver: null, submissionEmail: alias });

  await processBrokerWithPerson(makeContext(), DIRECT_BROKER, person);

  const detail = logged.find(l => l.name === DIRECT_BROKER.name).detail;
  const saved = recorded.pending[0].snippet;
  for (const text of [detail, saved]) {
    for (const v of ['Test', 'User', 'Exampleton', '00000', alias]) assert.ok(!text.includes(v), `"${v}" left in: ${text}`);
    assert.match(text, /confirmation email/);
  }
});
