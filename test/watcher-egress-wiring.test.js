'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { watcherSource, modeSource } = require('./helpers/watcher-source');

const src = watcherSource();

test('the email step forces a fresh egress check instead of resetting the gate', () => {
  assert.match(src, /ensureNodeEgress\(cfg, \{ fresh: true \}\)/);
  assert.ok(!/_resetNodeEgress/.test(src), 'watcher must not wipe the gate config mid-run');
});

test('the broker loop re-checks the browser egress', () => {
  assert.match(src, /makeEgressCounter\(\(\) => session\.recheckEgress\(\)\)/);
  assert.match(src, /await beforeBroker\(\);/);
});

