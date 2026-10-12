'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { watcherSource, modeSource } = require('./helpers/watcher-source');

const src = watcherSource();

test('the email step forces a fresh egress check instead of resetting the gate', () => {
  assert.match(src, /ensureNodeEgress\(cfg, \{ fresh: true \}\)/);
  assert.ok(!/_resetNodeEgress/.test(src), 'watcher must not wipe the gate config mid-run');
});

test('both broker loops re-check the browser egress', () => {
  assert.match(src, /makeEgressCounter\(\(\) => session\.recheckEgress\(\)\)/);
  assert.match(src, /await beforeBroker\(\);/);
  assert.match(src, /recheckEgress: session\.recheckEgress/);
});

test.skip('the explicit-loop re-check counter runs across persons (replaced by Task 7)', () => {
  const counter = src.indexOf('let sinceCheck = 0;');
  assert.ok(counter > 0);
  assert.ok(counter < src.indexOf('for (const { person, email: submissionEmail, masked } of plan.allowed)'));
});

test('a VPN drop in the generic pass stops the run cleanly', () => {
  const run = modeSource('run');
  const block = run.slice(run.indexOf('await runGenericBrokers(context'), run.indexOf('results.genericStats = genericTotals'));
  assert.match(block, /instanceof EgressError/);
  assert.match(block, /saveState\(\)/);
  assert.match(block, /process\.exitCode = 1/);
});
