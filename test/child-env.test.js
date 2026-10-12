'use strict';
/*
 * test/child-env.test.js - audit L4: dashboard credentials do not leak into
 * spawned children. Keeps UPEC_WIPE_PASSPHRASE_FILE / UPEC_WIPE_PASSPHRASE (runs need them).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { childEnv, cliChildEnv } = require('../lib/child-env');

const BASE = { UPEC_WIPE_PASS: 'a', UPEC_WIPE_USER: 'b', UPEC_WIPE_TOKEN: 'c', UPEC_WIPE_PASSPHRASE_FILE: '/f', UPEC_WIPE_PASSPHRASE: 'p', PATH: '/bin' };

test('L4: watcher-bound children lose UPEC_WIPE_PASS, UPEC_WIPE_USER and UPEC_WIPE_TOKEN', () => {
  const env = cliChildEnv('run', BASE);
  for (const k of ['UPEC_WIPE_PASS', 'UPEC_WIPE_USER', 'UPEC_WIPE_TOKEN']) assert.equal(k in env, false);
  assert.equal(env.UPEC_WIPE_PASSPHRASE_FILE, '/f');
  assert.equal(env.UPEC_WIPE_PASSPHRASE, 'p');
  assert.equal(env.PATH, '/bin');
});

test('L4: the dashboard child keeps its own credentials (it needs them to boot)', () => {
  const env = cliChildEnv('dashboard', BASE);
  assert.equal(env.UPEC_WIPE_PASS, 'a');
  assert.equal(env.UPEC_WIPE_USER, 'b');
});

test('L4: childEnv does not mutate its input', () => {
  const input = { ...BASE };
  childEnv(input);
  assert.deepEqual(input, BASE);
});

test('L4: bin/upec-wipe.js builds the child env through cliChildEnv', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'bin', 'upec-wipe.js'), 'utf8');
  assert.match(src, /cliChildEnv\(resolved\.command, process\.env\)/);
});
