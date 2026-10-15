/**
 * test/cli-bin-smoke.test.js
 *
 * Hermetic smoke test for the bin/upec-wipe.js dispatcher. Only exercises the
 * non-spawning paths (--help, --version, unknown command) by running the bin
 * as a child process and asserting its exit code + output. No network, no
 * real opt-out run.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'upec-wipe.js');

function runBin(args) {
  try {
    const stdout = execFileSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') };
  }
}

test('upec-wipe --help exits 0 and lists subcommands', () => {
  const r = runBin(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Usage: upec-wipe/);
  assert.match(r.stdout, /\bsetup\b/);
  assert.match(r.stdout, /\bweb-check\b/);
});

test('upec-wipe with no args prints help and exits 0', () => {
  const r = runBin([]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Usage: upec-wipe/);
});

test('upec-wipe --version prints the package version and exits 0', () => {
  const r = runBin(['--version']);
  assert.equal(r.code, 0);
  const pkg = require('../package.json');
  assert.match(r.stdout, new RegExp(pkg.version.replace(/\./g, '\\.')));
});

test('upec-wipe unknown-command prints help and exits non-zero', () => {
  const r = runBin(['frobnicate']);
  assert.notEqual(r.code, 0);
  const combined = r.stdout + (r.stderr || '');
  assert.match(combined, /unknown command: frobnicate/);
});
