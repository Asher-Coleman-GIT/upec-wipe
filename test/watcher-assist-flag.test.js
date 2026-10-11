/**
 * test/watcher-assist-flag.test.js
 *
 * --assist waits for the member to clear bot checks in the browser window, so
 * it is refused before anything runs when there is no visible window, and it
 * reaches the broker runner when there is.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'watcher.js'), 'utf8');

test('--assist without a visible browser window is refused before any work', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'watcher.js'), '--assist'],
    { encoding: 'utf8', timeout: 30000, env: { ...process.env, HEADLESS: '1' } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--assist needs a visible browser window/);
});

test('both broker-runner configure calls pass the assist flag', () => {
  const calls = src.match(/brokerRunner\.configure\(\{[^}]*\}\)/g) || [];
  assert.ok(calls.length >= 2);
  for (const c of calls) assert.match(c, /assist: ASSIST/);
});
