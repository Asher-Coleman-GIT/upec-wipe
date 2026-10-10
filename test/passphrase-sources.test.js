/**
 * test/passphrase-sources.test.js
 *
 * The passphrase may come from AIDR_PASSPHRASE, a file named by
 * AIDR_PASSPHRASE_FILE, or the default file ~/.config/auto-identity-remove/passphrase.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getPassphrase, readPassphraseFile } = require('../lib/config');

function tmpFile(content, mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidr-pp-'));
  const f = path.join(dir, 'pp');
  fs.writeFileSync(f, content, { mode: mode || 0o600 });
  fs.chmodSync(f, mode || 0o600);
  return { dir, f };
}
const POSIX = process.platform !== 'win32';

test('override beats everything', () => {
  assert.equal(getPassphrase('ov', { AIDR_PASSPHRASE: 'env' }), 'ov');
});

test('env var beats file', () => {
  const { f } = tmpFile('file\n');
  assert.equal(getPassphrase(undefined, { AIDR_PASSPHRASE: 'env', AIDR_PASSPHRASE_FILE: f }), 'env');
});

test('AIDR_PASSPHRASE_FILE is read and one trailing LF or CRLF stripped', () => {
  assert.equal(getPassphrase(undefined, { AIDR_PASSPHRASE_FILE: tmpFile('s3cret\n').f }), 's3cret');
  assert.equal(getPassphrase(undefined, { AIDR_PASSPHRASE_FILE: tmpFile('s3cret\r\n').f }), 's3cret');
  assert.equal(getPassphrase(undefined, { AIDR_PASSPHRASE_FILE: tmpFile('  spaced  ').f }), '  spaced  ');
});

test('nothing set yields empty string', () => {
  assert.equal(getPassphrase(undefined, {}), '');
});

test('group/world-readable passphrase file is refused', { skip: !POSIX }, () => {
  const { f } = tmpFile('x', 0o644);
  assert.throws(() => readPassphraseFile(f), /readable by other users/);
  assert.throws(() => getPassphrase(undefined, { AIDR_PASSPHRASE_FILE: f }), /readable by other users/);
});

test('empty passphrase file is refused', () => {
  assert.throws(() => readPassphraseFile(tmpFile('\n').f), /empty/);
});

test('missing AIDR_PASSPHRASE_FILE path throws a clear error', () => {
  assert.throws(() => getPassphrase(undefined, { AIDR_PASSPHRASE_FILE: '/nonexistent/aidr' }), /AIDR_PASSPHRASE_FILE/);
});

// I1 (final review): ~/.config/auto-identity-remove/passphrase is the lowest-
// priority source, so manual commands work unprefixed after --encrypt-config.
function homeWithDefault(content, mode) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aidr-home-'));
  if (content !== undefined) {
    const dir = path.join(home, '.config', 'auto-identity-remove');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'passphrase');
    fs.writeFileSync(f, content, { mode: mode || 0o600 });
    fs.chmodSync(f, mode || 0o600);
  }
  return home;
}

test('default passphrase file in the home config dir is used last', () => {
  const home = homeWithDefault('fromdefault\n');
  assert.equal(getPassphrase(undefined, {}, home), 'fromdefault');
  assert.equal(getPassphrase(undefined, { HOME: home }), 'fromdefault', 'HOME from an injected env is honoured');
});

test('default passphrase file has the lowest priority', () => {
  const home = homeWithDefault('fromdefault');
  assert.equal(getPassphrase(undefined, { AIDR_PASSPHRASE: 'env' }, home), 'env');
  assert.equal(getPassphrase(undefined, { AIDR_PASSPHRASE_FILE: tmpFile('file').f }, home), 'file');
});

test('absent default passphrase file yields empty', () => {
  assert.equal(getPassphrase(undefined, {}, homeWithDefault()), '');
});

test('group/world-readable default passphrase file is refused', { skip: !POSIX }, () => {
  const home = homeWithDefault('x', 0o644);
  assert.throws(() => getPassphrase(undefined, {}, home), /readable by other users/);
});

test('default passphrase path that is not a readable file throws (only ENOENT means absent)', () => {
  const home = homeWithDefault();
  fs.mkdirSync(path.join(home, '.config', 'auto-identity-remove', 'passphrase'), { recursive: true });
  assert.throws(() => getPassphrase(undefined, {}, home));
});
