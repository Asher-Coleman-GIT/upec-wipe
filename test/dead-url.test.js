/**
 * test/dead-url.test.js
 *
 * Unit tests for loadDeadSet in lib/dead-urls.js (using temp files).
 */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');

const { loadDeadSet } = require('../lib/dead-urls');

// ── loadDeadSet ───────────────────────────────────────────────────────────────

test('loadDeadSet reads hosts from a valid JSON file', () => {
  const tmp = path.join(os.tmpdir(), `dead-urls-test-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ hosts: ['gone.com', 'stale.net'] }), 'utf8');
  const set = loadDeadSet(tmp);
  assert.equal(set.has('gone.com'), true);
  assert.equal(set.has('stale.net'), true);
  assert.equal(set.size, 2);
  fs.unlinkSync(tmp);
});

test('loadDeadSet returns empty Set when file is missing', () => {
  const set = loadDeadSet('/tmp/this-file-does-not-exist-dead-urls.json');
  assert.equal(set.size, 0);
});

test('loadDeadSet returns empty Set when JSON is malformed', () => {
  const tmp = path.join(os.tmpdir(), `dead-urls-bad-${Date.now()}.json`);
  fs.writeFileSync(tmp, 'NOT JSON', 'utf8');
  const set = loadDeadSet(tmp);
  assert.equal(set.size, 0);
  fs.unlinkSync(tmp);
});

test('loadDeadSet returns empty Set when hosts is not an array', () => {
  const tmp = path.join(os.tmpdir(), `dead-urls-noarr-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ hosts: null }), 'utf8');
  const set = loadDeadSet(tmp);
  assert.equal(set.size, 0);
  fs.unlinkSync(tmp);
});
