'use strict';
/*
 * test/child-env.test.js - audit L4: dashboard credentials do not leak into
 * spawned children. Keeps AIDR_PASSPHRASE_FILE / AIDR_PASSPHRASE (runs need them).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { childEnv, cliChildEnv } = require('../lib/child-env');

const BASE = { AIDR_PASS: 'a', AIDR_USER: 'b', AIDR_TOKEN: 'c', AIDR_PASSPHRASE_FILE: '/f', AIDR_PASSPHRASE: 'p', PATH: '/bin' };

test('L4: watcher-bound children lose AIDR_PASS, AIDR_USER and AIDR_TOKEN', () => {
  const env = cliChildEnv('run', BASE);
  for (const k of ['AIDR_PASS', 'AIDR_USER', 'AIDR_TOKEN']) assert.equal(k in env, false);
  assert.equal(env.AIDR_PASSPHRASE_FILE, '/f');
  assert.equal(env.AIDR_PASSPHRASE, 'p');
  assert.equal(env.PATH, '/bin');
});

test('L4: the dashboard child keeps its own credentials (it needs them to boot)', () => {
  const env = cliChildEnv('dashboard', BASE);
  assert.equal(env.AIDR_PASS, 'a');
  assert.equal(env.AIDR_USER, 'b');
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
