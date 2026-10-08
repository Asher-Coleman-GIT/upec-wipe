/**
 * test/run-sh.test.js
 *
 * run.sh is what every scheduler invokes. It must create files owner-only and
 * must accept an encrypted-only setup (config.json.enc without config.json).
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'run.sh'), 'utf8');

test('run.sh parses', () => { execFileSync('bash', ['-n', path.join(__dirname, '..', 'run.sh')]); });

test('run.sh sets umask 077 before running node', () => {
  const u = SRC.indexOf('umask 077');
  assert.ok(u !== -1, 'umask 077 missing');
  assert.ok(u < SRC.indexOf('node watcher.js'));
});

test('run.sh accepts config.json.enc', () => {
  assert.match(SRC, /config\.json\.enc/);
});

test('run.sh refuses to run as root', () => {
  assert.match(SRC, /id -u/);
});
