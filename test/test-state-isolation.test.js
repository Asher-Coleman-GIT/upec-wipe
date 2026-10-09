/**
 * test/test-state-isolation.test.js
 *
 * The npm test preload (test/helpers/egress-off.js) points AIDR_STATE_PATH at a
 * per-process temp file, so parallel test files never race on (or write) the
 * repo's own state.json. Tests that need a specific state file still set
 * AIDR_STATE_PATH or call setTestStatePath themselves.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

test('the test preload gives this process a temp state path, not the repo state.json', () => {
  const p = process.env.AIDR_STATE_PATH;
  assert.ok(p, 'AIDR_STATE_PATH is set by the preload');
  assert.ok(path.resolve(p).startsWith(path.resolve(os.tmpdir())), `${p} is under the OS temp dir`);
  assert.notEqual(path.resolve(p), path.resolve(__dirname, '..', 'state.json'));
  assert.equal(require('../lib/config').STATE_PATH, path.resolve(p));
});
