'use strict';
/**
 * test/allowlist-encrypted.test.js
 *
 * Review 2026-10-15: --allow/--unallow edited plain config.json, but runs read
 * config.json.enc when it exists (or decrypt an envelope in config.json), so
 * "Added to allowlist" changed nothing and the broker was still opted out.
 * With an encrypted config the command now refuses and says how to do it.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeFixtureRepo } = require('./helpers/fixture-repo');

function allow(dir) {
  return spawnSync(process.execPath, [path.join(dir, 'watcher.js'), '--allow', 'Spokeo'], {
    encoding: 'utf8', timeout: 30000, cwd: dir,
    env: { ...process.env, NODE_ENV: 'test', HOME: dir, UPEC_WIPE_STATE_PATH: path.join(dir, 'state.json') },
  });
}

test('--allow refuses when config.json.enc exists, and leaves config.json alone', () => {
  const dir = makeFixtureRepo();
  try {
    const cfg = path.join(dir, 'config.json');
    const before = JSON.stringify({ person: { firstName: 'Jane' } });
    fs.writeFileSync(cfg, before, { mode: 0o600 });
    fs.writeFileSync(path.join(dir, 'config.json.enc'), '{"v":1}', { mode: 0o600 });
    const r = allow(dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /encrypted/i);
    assert.match(r.stderr, /--decrypt-config/);
    assert.equal(fs.readFileSync(cfg, 'utf8'), before);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('--allow refuses when config.json itself is an encrypted envelope', () => {
  const dir = makeFixtureRepo();
  try {
    const cfg = path.join(dir, 'config.json');
    const envelope = JSON.stringify({ v: 1, salt: 'AA==', iv: 'AA==', tag: 'AA==', ciphertext: 'AA==' });
    fs.writeFileSync(cfg, envelope, { mode: 0o600 });
    const r = allow(dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(fs.readFileSync(cfg, 'utf8'), envelope);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
