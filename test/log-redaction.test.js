'use strict';
/*
 * test/log-redaction.test.js - audit L11: URL paths/queries and PII previews
 * must not reach persisted logs (logs/run-*.json). Stdout may still show them.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { redactUrl, redactUrlsInText } = require('../lib/redact');

test('L11: redactUrl keeps the origin only', () => {
  assert.equal(redactUrl('https://www.checkpeople.com/optout/jane-doe?email=jane%40x.com#a'), 'https://www.checkpeople.com');
  assert.equal(redactUrl('http://h.example:8080/p?q=1'), 'http://h.example:8080');
  assert.equal(redactUrl('not a url'), '[unparseable-url]');
});

test('L11: redactUrlsInText rewrites every URL in an error message', () => {
  const m = 'page.goto: Timeout 15000ms exceeded. navigating to "https://x.example/people/jane-doe?e=a@b.c", waiting until "load"';
  const out = redactUrlsInText(m);
  assert.ok(out.includes('https://x.example'));
  assert.ok(!/jane-doe|a@b\.c/.test(out));
});

test('L11: logResult persists the redacted detail but prints the full one', () => {
  const logger = require('../lib/logger');
  logger.resetResults();
  const printed = [];
  const orig = console.log; console.log = (s) => printed.push(s);
  try { logger.logResult('B', 'preview', 'input[first]="Jane"', 'values not persisted'); }
  finally { console.log = orig; }
  assert.match(printed[0], /Jane/);
  assert.equal(logger.results.skipped[0].detail, 'values not persisted');
  logger.resetResults();
});

test('L11: a navigation error carrying a name-in-URL is logged without it', async () => {
  const logged = [];
  const orig = Module._load;
  Module._load = function (request, parent, isMain) {
    if (!parent || !parent.filename || !parent.filename.includes('broker-runner')) return orig.call(this, request, parent, isMain);
    if (request === './logger') return { logResult: (n, s, d) => logged.push({ n, s, d }) };
    if (request === './config') return {
      shouldSkip: () => null, recordSuccess() {}, recordPendingConfirmation() {}, recordFailure() {},
      saveCheckpoint() {}, stateKey: (b) => b, isPendingConfirmation: () => false,
    };
    if (request === './timing') return { jitterSleep: async () => {} };
    if (request === './retry') return { withRetry: (fn) => fn() };
    return orig.call(this, request, parent, isMain);
  };
  const p = require.resolve('../lib/broker-runner');
  delete require.cache[p];
  const { configure, processBrokerWithPerson } = require('../lib/broker-runner');
  Module._load = orig;
  const person = { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', country: 'US' };
  configure({ dryRun: false, person, capsolver: null });
  const ctx = { newPage: async () => ({
    goto: async () => { throw new Error('net::ERR_FAILED at https://cp.example/optout/Jane-Doe?e=jane@example.com'); },
    close: async () => {},
  }) };
  await processBrokerWithPerson(ctx, { name: 'CP', method: 'direct-form', optOutUrl: 'https://cp.example/optout/Jane-Doe', formFields: {} }, person);
  const err = logged.find(l => l.s === 'error');
  assert.ok(err, 'an error was logged');
  assert.ok(!/Jane|jane@/i.test(err.d), `detail leaked: ${err.d}`);
});
