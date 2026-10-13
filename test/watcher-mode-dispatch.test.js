/**
 * test/watcher-mode-dispatch.test.js
 *
 * Fix 6: mode-dispatch safety.
 *
 * Tests the pure resolveMode() helper that will be extracted from watcher.js:
 *   - Returns the single active mode name for each documented mode
 *   - Returns null for no special mode (normal run)
 *   - Returns an error string when more than one mutually-exclusive mode is set
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// We test a pure resolveMode function that we'll extract into watcher.js.
// Import it directly once it's implemented.
const { resolveMode } = require('../lib/mode-dispatch');

// ── single-mode resolution ────────────────────────────────────────────────────

test('resolveMode: --list returns "list"', () => {
  const result = resolveMode({ list: true });
  assert.equal(result.mode, 'list');
  assert.equal(result.conflict, null);
});

test('resolveMode: --doctor returns "doctor"', () => {
  const result = resolveMode({ doctor: true });
  assert.equal(result.mode, 'doctor');
  assert.equal(result.conflict, null);
});

test('resolveMode: no flags returns null mode (normal run)', () => {
  const result = resolveMode({});
  assert.equal(result.mode, null);
  assert.equal(result.conflict, null);
});

// ── mutual-exclusion detection ────────────────────────────────────────────────

test('resolveMode: --list and --doctor together is a conflict', () => {
  const result = resolveMode({ list: true, doctor: true });
  assert.ok(typeof result.conflict === 'string', 'Conflict must be a string message');
  assert.ok(result.conflict.includes('list') && result.conflict.includes('doctor'), result.conflict);
});

test('resolveMode: --doctor and --serp-watch together is a conflict', () => {
  assert.notEqual(resolveMode({ doctor: true, serpWatch: true }).conflict, null);
});

test('resolveMode: three modes together is a conflict', () => {
  assert.notEqual(resolveMode({ list: true, pending: true, doctor: true }).conflict, null);
});

// ── pickMode: the one mode watcher.js runs for a set of parsed flags ──────────

const { pickMode } = require('../lib/mode-dispatch');
const { parseWatcherFlags } = require('../lib/cli-flags');
const pick = (...args) => pickMode(parseWatcherFlags(['node', 'watcher.js', ...args]));

test('pickMode: no mode flag is the opt-out run', () => {
  assert.deepEqual(pick(), { mode: 'run', conflict: null });
});

test('pickMode: early read-only modes win before the conflict check', () => {
  assert.equal(pick('--list', '--doctor').mode, 'list');
  assert.equal(pick('--pending', '--doctor').mode, 'pending');
});

test('pickMode: each mode by its flag', () => {
  assert.equal(pick('doctor').mode, 'doctor');
  assert.equal(pick('--reply', 'Pipl', 'honored').mode, 'reply');
  assert.equal(pick('--allow', 'Spokeo').mode, 'allowlist');
  assert.equal(pick('--encrypt-config').mode, 'encrypt-config');
  assert.equal(pick('--list').mode, 'list');
  assert.equal(pick('--pending').mode, 'pending');
});

test('pickMode: the first early mode wins among several', () => {
  assert.equal(pick('--reply', 'Pipl', 'honored', '--doctor').mode, 'reply');
  assert.equal(pick('--decrypt-config').mode, 'encrypt-config');
});

test('pickMode: serp-watch runs inside the opt-out run, and conflicts with doctor', () => {
  assert.equal(pick('--serp-watch').mode, 'run');
  const r = pick('--serp-watch', '--doctor');
  assert.equal(r.mode, null);
  assert.equal(r.conflict, 'Mutually exclusive modes cannot be combined: --doctor, --serp-watch. Use one at a time.');
});
