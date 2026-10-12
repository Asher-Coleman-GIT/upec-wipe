/**
 * test/doctor-encrypted.test.js
 *
 * F-D fact-check: doctor read only a plaintext config.json, so a member who
 * followed the manual and encrypted got "config.json not found - run setup"
 * and was pushed to re-run setup. doctor now reads the config the same way a
 * run does (config.json.enc with the usual passphrase sources).
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const secrets = require('../lib/secrets');
const { checkConfig } = require('../lib/doctor');

const PLAIN = { person: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', zip: '12345' } };

function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) { prev[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  return Promise.resolve().then(fn).finally(() => {
    for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  });
}

test('doctor checkConfig accepts an encrypted config when the passphrase is available', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-doc-enc-'));
  try {
    fs.writeFileSync(path.join(dir, 'config.json.enc'), JSON.stringify(secrets.encryptConfig(PLAIN, 'pp-123')));
    const r = await withEnv({ UPEC_WIPE_PASSPHRASE: 'pp-123' }, () => checkConfig(dir));
    assert.equal(r.ok, true, r.hint);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('doctor checkConfig on an encrypted config without a passphrase names the passphrase, not setup', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-doc-enc-'));
  try {
    fs.writeFileSync(path.join(dir, 'config.json.enc'), JSON.stringify(secrets.encryptConfig(PLAIN, 'pp-123')));
    const r = await withEnv({ UPEC_WIPE_PASSPHRASE: undefined, UPEC_WIPE_PASSPHRASE_FILE: undefined, HOME: dir, USERPROFILE: dir }, () => checkConfig(dir));
    assert.equal(r.ok, false);
    assert.match(r.hint, /passphrase/i);
    assert.doesNotMatch(r.hint, /setup/);
    assert.doesNotMatch(r.hint, /Ada|Lovelace|ada@/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
