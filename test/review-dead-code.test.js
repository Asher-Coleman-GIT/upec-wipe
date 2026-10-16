'use strict';
/**
 * test/review-dead-code.test.js
 *
 * Review 2026-10-15 (low): scripts/prune-dead.js read a log format runs no
 * longer write (and would have put broker names into the tracked
 * data/dead-urls.json as hosts); classifyNavError, isDeadStatus, buildAlert and
 * matchBrokers had no caller; a killed web-check could leave
 * data/serp-history.json.tmp for `git add -A` to pick up.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

test('the dead helpers and script are gone', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'scripts', 'prune-dead.js')), false);
  const deadUrls = require('../lib/dead-urls');
  assert.equal(deadUrls.classifyNavError, undefined);
  assert.equal(deadUrls.isDeadStatus, undefined);
  assert.equal(require('../lib/serp-watch').buildAlert, undefined);
  assert.equal(require('../lib/serp-scan').matchBrokers, undefined);
});

test('a left-over web-check temp file is ignored by git', () => {
  const out = execFileSync('git', ['check-ignore', 'data/serp-history.json.tmp'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /serp-history\.json\.tmp/);
});
