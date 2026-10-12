/**
 * test/package-bin.test.js
 *
 * Verifies the npx/installable CLI wiring in package.json: the bin entry
 * points at bin/upec-wipe.js and that file exists and is executable.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const pkg = require('../package.json');

test('package.json declares the upec-wipe bin pointing at bin/upec-wipe.js', () => {
  assert.ok(pkg.bin, 'package.json must have a "bin" field');
  assert.equal(pkg.bin['upec-wipe'], './bin/upec-wipe.js');
});

test('bin/upec-wipe.js exists on disk', () => {
  const binPath = path.join(ROOT, 'bin', 'upec-wipe.js');
  assert.ok(fs.existsSync(binPath), 'bin/upec-wipe.js must exist');
});

test('bin/upec-wipe.js starts with a node shebang', () => {
  const binPath = path.join(ROOT, 'bin', 'upec-wipe.js');
  const head = fs.readFileSync(binPath, 'utf8').split('\n')[0];
  assert.match(head, /^#!\/usr\/bin\/env node/);
});

test('package.json files whitelist includes bin and lib', () => {
  assert.ok(Array.isArray(pkg.files), 'package.json must have a "files" array');
  assert.ok(pkg.files.includes('bin/'), 'files must include bin/');
  assert.ok(pkg.files.includes('lib/'), 'files must include lib/');
});
