/**
 * test/parse-error-no-pii.test.js
 *
 * V8's JSON SyntaxError message quotes the text around the error, so a hand
 * edit that breaks config.json or state.json could put an email or name into
 * any output that prints err.message. loadConfig (and the encrypt/decrypt
 * helpers) throw a content-free SyntaxError that names the file only, and
 * doctor reports a fixed reason.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const cfg = require('../lib/config');
const doctor = require('../lib/doctor');

const BAD = '{"person": {"email": jane.doe@example.com, "lastName": "Turing"}}';
const PII = /jane|example\.com|Turing/i;

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-parse-')); }

test('loadConfig: a malformed config.json throws a SyntaxError naming the file, not its contents', () => {
  const dir = tmp();
  try {
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, BAD);
    assert.throws(() => cfg.loadConfig({ configPath, encPath: path.join(dir, 'config.json.enc'), passphrase: '' }), (e) => {
      assert.ok(e instanceof SyntaxError);
      assert.equal(e.message, 'config.json is not valid JSON');
      return true;
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('loadConfig: a malformed config.json.enc is named as such', () => {
  const dir = tmp();
  try {
    const encPath = path.join(dir, 'config.json.enc');
    fs.writeFileSync(encPath, BAD);
    assert.throws(() => cfg.loadConfig({ configPath: path.join(dir, 'config.json'), encPath, passphrase: 'pp' }),
      (e) => e instanceof SyntaxError && e.message === 'config.json.enc is not valid JSON');
    assert.equal(cfg.configErrorReason(new SyntaxError('config.json.enc is not valid JSON')), 'config.json is not valid JSON', 'foreign SyntaxErrors still get the fixed text');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('configErrorReason passes through the content-free SyntaxError message', () => {
  const dir = tmp();
  try {
    const encPath = path.join(dir, 'config.json.enc');
    fs.writeFileSync(encPath, BAD);
    let err;
    try { cfg.loadConfig({ configPath: path.join(dir, 'config.json'), encPath, passphrase: 'pp' }); } catch (e) { err = e; }
    assert.equal(cfg.configErrorReason(err), 'config.json.enc is not valid JSON');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('doctor: malformed config.json and state.json report a fixed reason', async () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, 'config.json'), BAD);
    fs.writeFileSync(path.join(dir, 'state.json'), '{"optOuts": {"Spokeo|Jane Turing": oops}}');
    const c = await doctor.checkConfig(dir);
    const s = await doctor.checkState(dir);
    assert.equal(c.ok, false);
    assert.equal(s.ok, false);
    assert.doesNotMatch(c.hint, PII);
    assert.doesNotMatch(s.hint, /Jane|Turing|Spokeo/);
    assert.match(c.hint, /config\.json is not valid JSON/);
    assert.match(s.hint, /state\.json is not valid JSON/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
