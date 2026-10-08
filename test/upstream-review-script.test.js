/**
 * test/upstream-review-script.test.js
 *
 * The fork pins upstream at UPSTREAM_BASE and only pulls changes after a human
 * reads the diff. This checks the review script exists, parses, never runs a
 * mutating git command, and that the pin is a full SHA.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'upstream-review.sh');

test('UPSTREAM_BASE is a full 40-char SHA', () => {
  const sha = fs.readFileSync(path.join(ROOT, 'UPSTREAM_BASE'), 'utf8').trim();
  assert.match(sha, /^[0-9a-f]{40}$/);
});

test('upstream-review.sh parses with bash -n', () => {
  execFileSync('bash', ['-n', SCRIPT]);
});

test('upstream-review.sh never merges, rebases, resets, checks out or pushes', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  for (const verb of ['merge', 'rebase', 'reset', 'checkout', 'push', 'pull', 'cherry-pick']) {
    assert.ok(!new RegExp(`git\\s+${verb}\\b`).test(src), `script must not run git ${verb}`);
  }
});
