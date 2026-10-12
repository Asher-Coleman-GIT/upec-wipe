/**
 * test/captcha-egress.test.js
 *
 * C1 review minor: each CapSolver solver caught every error and returned
 * false, so a failed Node-side egress check (EgressError) was logged as
 * "captcha_failed" per broker and the run carried on and exited 0. An
 * EgressError must propagate: out of the solver, out of processBrokerWithPerson
 * (after closing the page), and stop the watcher's broker loop with exit 1.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const egress = require('../lib/egress');
const { modeSource } = require('./helpers/watcher-source');
const { EgressError } = egress;
const captcha = require('../lib/captcha');

function failingGate() {
  egress._resetNodeEgress();
  egress.setEgressConfig({}, { fetchJson: async () => ({ mullvad_exit_ip: false }) });
}

// Page stub: first evaluate detects the captcha type, the rest return a sitekey.
function captchaPage(type) {
  let n = 0;
  return { url: () => 'https://broker.example/optout', evaluate: async () => (n++ === 0 ? type : 'SITEKEY'), waitForTimeout: async () => {} };
}

for (const type of ['recaptcha', 'hcaptcha', 'turnstile', 'recaptcha-v3', 'aws-waf']) {
  test(`detectAndSolveCaptcha (${type}) rethrows EgressError instead of returning false`, async () => {
    failingGate();
    try {
      await assert.rejects(() => captcha.detectAndSolveCaptcha(captchaPage(type), { apiKey: 'CAP-REALKEY' }, { name: 'B' }), EgressError);
    } finally { egress._resetNodeEgress(); }
  });
}

test('processBrokerWithPerson lets EgressError out and still closes the page', async () => {
  const originalLoad = Module._load.bind(Module);
  const logged = [];
  Module._load = function (request, parent, isMain) {
    if (!parent?.filename?.includes('broker-runner')) return originalLoad(request, parent, isMain);
    if (request === './config') return {
      RECHECK_DAYS: 90, CONFIRM_RECHECK_DAYS: 14, lastOptOutDaysAgo: () => Infinity, shouldSkip: () => null,
      isPendingConfirmation: () => false, recordSuccess: () => {}, recordPendingConfirmation: () => {},
      recordFailure: () => {}, loadState: () => ({ optOuts: {} }), saveCheckpoint: () => {}, stateKey: (b) => b,
    };
    if (request === './logger') return { logResult: (n, s) => logged.push(s), STATUS_BUCKET: {} };
    if (request === './forms') return { fillForm: async () => ({ filled: [{ selector: 'input[name="first"]', value: 'Jane', kind: 'text' }], missed: [] }), findListingUrl: async () => null };
    if (request === './captcha') return { detectAndSolveCaptcha: async () => { throw new EgressError('gate'); } };
    if (request === './retry') return { withRetry: (fn) => fn() };
    if (request === './timing') return { jitterSleep: async () => {} };
    return originalLoad(request, parent, isMain);
  };
  const p = require.resolve('../lib/broker-runner');
  delete require.cache[p];
  const runner = require('../lib/broker-runner');
  Module._load = originalLoad;
  delete require.cache[p];

  let closed = 0;
  const context = { newPage: async () => ({
    goto: async () => ({ status: () => 200 }),
    locator: () => ({ first: () => ({ fill: async () => {}, count: async () => 1, isVisible: async () => true, click: async () => {} }) }),
    evaluate: async () => '',
    close: async () => { closed++; },
  }) };
  const person = { firstName: 'T', lastName: 'U', email: 't@example.com', country: 'US' };
  runner.configure({ dryRun: false, person, capsolver: { apiKey: 'CAP-REALKEY' } });
  const broker = { name: 'CapBroker', method: 'direct-form', optOutUrl: 'https://example.com/o', captchaLikely: true, formFields: {} };
  await assert.rejects(() => runner.processBrokerWithPerson(context, broker, person), EgressError);
  assert.ok(closed >= 1, 'page closed');
  assert.deepEqual(logged.filter((s) => s === 'error' || s === 'captcha_failed'), [], 'not logged as a per-broker failure');
});

test('watcher stops the explicit broker loop on EgressError with exit code 1', () => {
  const src = modeSource('run');
  const loop = src.slice(src.indexOf('for (const broker of sorted)'), src.indexOf('// Build the set of explicit broker hostnames'));
  assert.match(loop, /catch \(err\) \{\s*if \(!\(err instanceof EgressError\)\) throw err;/);
  assert.match(loop, /process\.exitCode = 1;/);
});
