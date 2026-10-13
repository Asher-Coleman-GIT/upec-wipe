'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { modeSource } = require('./helpers/watcher-source');
const src = modeSource('run');

test('the email step runs only under --email', () => {
  const calls = src.match(/runEmailStep\(/g) || [];
  assert.equal(calls.length, 1);
  assert.match(src, /if \(EMAIL\) \{[\s\S]{0,1500}runEmailStep\(\{/);
});

test('the forms run no longer sends email', () => {
  assert.ok(!/sendOptOutEmails\(/.test(src), 'sendOptOutEmails must not be called from watcher.js');
});

test('--email alone returns before the browser opens', () => {
  assert.match(src, /if \(!FORMS\) return;/);
});

test('each send re-runs the egress check instead of reusing the cached result', () => {
  assert.match(modeSource('shared'), /ensureEgress: \(cfg\) => ensureNodeEgress\(cfg, \{ fresh: true \}\)/);
});

test('--list reads email status through emailStatus (multi-person keys)', () => {
  assert.match(modeSource('list'), /emailStatus\(state, n\)/);
});
