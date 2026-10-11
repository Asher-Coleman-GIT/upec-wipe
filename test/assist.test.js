/**
 * test/assist.test.js
 *
 * --assist: when a broker page shows a challenge a person can clear, the run
 * waits for the member to complete it in the browser window, then carries on.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { waitForHumanCheck } = require('../lib/assist');

function fakePage() {
  return { bringToFront: async () => { fakePage.fronted = true; } };
}
const noSleep = async () => {};

test('returns true once the challenge clears, and brings the window forward', async () => {
  const seq = [{ reason: 'x', solvable: true }, { reason: 'x', solvable: true }, null];
  const lines = [];
  const ok = await waitForHumanCheck(fakePage(), {
    brokerName: 'TruePeopleSearch', timeoutMs: 60000, pollMs: 1,
    check: async () => seq.shift(), sleep: noSleep, log: (s) => lines.push(s),
  });
  assert.equal(ok, true);
  assert.equal(fakePage.fronted, true);
  assert.match(lines.join('\n'), /TruePeopleSearch.*complete the check in the browser window/);
  assert.match(lines.join('\n'), /cleared/);
});

test('returns false when the check is not completed in time', async () => {
  let t = 0;
  const ok = await waitForHumanCheck(fakePage(), {
    brokerName: 'B', timeoutMs: 50, pollMs: 10,
    check: async () => ({ reason: 'x', solvable: true }), sleep: async (ms) => { t += ms; }, now: () => t, log: () => {},
  });
  assert.equal(ok, false);
});

test('gives up at once if the page turns into a hard block', async () => {
  let calls = 0;
  const ok = await waitForHumanCheck(fakePage(), {
    brokerName: 'B', timeoutMs: 60000, pollMs: 1,
    check: async () => { calls++; return { reason: 'x', solvable: false }; }, sleep: noSleep, log: () => {},
  });
  assert.equal(ok, false);
  assert.equal(calls, 1);
});
