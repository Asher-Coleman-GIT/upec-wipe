'use strict';
/**
 * test/state-lock-order.test.js
 *
 * Review 2026-10-15 (low): a run read state.json when lib/config loaded and
 * only took the lock later, so a `done`/`reply` finished in between was
 * overwritten by the run's first save. read-email took the lock per logged
 * reply and exited mid-session when a run held it.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('a run reloads state right after taking the lock', () => {
  const s = src('lib/modes/run.js');
  assert.match(s, /acquireStateLockOrExit\(\);\s*\n(\s*\/\/[^\n]*\n)*\s*require\('\.\.\/config'\)\.resetState\(\);/);
});

test('read-email takes the lock once, before the mailbox, and logs replies without re-locking', () => {
  const s = src('lib/modes/read-email.js');
  const lockAt = s.indexOf('acquireStateLockOrExit()');
  assert.ok(lockAt !== -1 && lockAt < s.indexOf('await readEmail('), 'lock before reading');
  assert.equal(s.split('acquireStateLockOrExit()').length - 1, 1, 'exactly one acquire');
  assert.match(s, /finally \{[\s\S]*lock\.release/);
});
