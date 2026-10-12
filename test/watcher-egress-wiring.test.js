'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'watcher.js'), 'utf8');

test('the email step forces a fresh egress check instead of resetting the gate', () => {
  assert.match(src, /ensureNodeEgress\(cfg, \{ fresh: true \}\)/);
  assert.ok(!/_resetNodeEgress/.test(src), 'watcher must not wipe the gate config mid-run');
});
