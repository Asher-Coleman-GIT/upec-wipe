/**
 * test/passphrase-sources.test.js
 *
 * The passphrase may come from AIDR_PASSPHRASE, a file named by
 * AIDR_PASSPHRASE_FILE, or a systemd credential (LoadCredential=aidr-passphrase:...).
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

test('systemd CREDENTIALS_DIRECTORY/aidr-passphrase is used', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidr-cred-'));
  fs.writeFileSync(path.join(dir, 'aidr-passphrase'), 'fromcred');
  assert.equal(getPassphrase(undefined, { CREDENTIALS_DIRECTORY: dir }), 'fromcred');
});

test('missing credential file under CREDENTIALS_DIRECTORY yields empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidr-cred-'));
  assert.equal(getPassphrase(undefined, { CREDENTIALS_DIRECTORY: dir }), '');
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
