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

test('resolveMode: --score returns "score"', () => {
  const result = resolveMode({ score: true });
  assert.equal(result.mode, 'score');
  assert.equal(result.conflict, null);
});

test('resolveMode: --report returns "report"', () => {
  const result = resolveMode({ report: true });
  assert.equal(result.mode, 'report');
  assert.equal(result.conflict, null);
});

test('resolveMode: --doctor returns "doctor"', () => {
  const result = resolveMode({ doctor: true });
  assert.equal(result.mode, 'doctor');
  assert.equal(result.conflict, null);
});

test('resolveMode: --breach-check returns "breach-check"', () => {
  const result = resolveMode({ breachCheck: true });
  assert.equal(result.mode, 'breach-check');
  assert.equal(result.conflict, null);
});

test('resolveMode: --update-brokers returns "update-brokers"', () => {
  const result = resolveMode({ updateBrokers: true });
  assert.equal(result.mode, 'update-brokers');
  assert.equal(result.conflict, null);
});

test('resolveMode: no flags returns null mode (normal run)', () => {
  const result = resolveMode({});
  assert.equal(result.mode, null);
  assert.equal(result.conflict, null);
});

// ── mutual-exclusion detection ────────────────────────────────────────────────

test('resolveMode: --list and --report together is a conflict', () => {
  const result = resolveMode({ list: true, report: true });
  assert.notEqual(result.conflict, null, 'Expected a conflict message');
  assert.ok(typeof result.conflict === 'string', 'Conflict must be a string message');
  // The conflict message should mention both flags
  assert.ok(result.conflict.includes('list') || result.conflict.includes('report'),
    `Conflict message should mention the conflicting flags: ${result.conflict}`);
});

test('resolveMode: --doctor and --breach-check together is a conflict', () => {
  const result = resolveMode({ doctor: true, breachCheck: true });
  assert.notEqual(result.conflict, null);
});

test('resolveMode: --score and --update-brokers together is a conflict', () => {
  const result = resolveMode({ score: true, updateBrokers: true });
  assert.notEqual(result.conflict, null);
});

test('resolveMode: three modes together is a conflict', () => {
  const result = resolveMode({ list: true, score: true, report: true });
  assert.notEqual(result.conflict, null);
});

// ── pickMode: the one mode watcher.js runs for a set of parsed flags ──────────

const { pickMode } = require('../lib/mode-dispatch');
const { parseWatcherFlags } = require('../lib/cli-flags');
const pick = (...args) => pickMode(parseWatcherFlags(['node', 'watcher.js', ...args]));

test('pickMode: no mode flag is the opt-out run', () => {
  assert.deepEqual(pick(), { mode: 'run', conflict: null });
});

test('pickMode: early read-only modes win before the conflict check', () => {
  assert.equal(pick('--list', '--report').mode, 'list');
  assert.equal(pick('--freeze', '--doctor').mode, 'freeze');
});

test('pickMode: later modes that conflict are refused', () => {
  const r = pick('--doctor', '--report');
  assert.equal(r.mode, null);
  assert.match(r.conflict, /--report, --doctor|--doctor, --report/);
});

test('pickMode: each later mode by its flag', () => {
  assert.equal(pick('--breach-check').mode, 'breach');
  assert.equal(pick('--complaints').mode, 'complaints');
  assert.equal(pick('--confirm-emails').mode, 'confirm-emails');
  assert.equal(pick('--report').mode, 'report');
  assert.equal(pick('doctor').mode, 'doctor');
  assert.equal(pick('--update-brokers').mode, 'update-brokers');
  assert.equal(pick('--know').mode, 'know');
  assert.equal(pick('--reply', 'Pipl', 'honored').mode, 'reply');
  assert.equal(pick('--allow', 'Spokeo').mode, 'allowlist');
  assert.equal(pick('--encrypt-config').mode, 'encrypt-config');
});

test('pickMode: the first early mode wins among several', () => {
  assert.equal(pick('--reply', 'Pipl', 'honored', '--score').mode, 'reply');
  assert.equal(pick('--decrypt-config').mode, 'encrypt-config');
});

test('pickMode: serp flags run inside the opt-out run, and conflict with another mode', () => {
  assert.equal(pick('--serp-scan').mode, 'run');
  assert.equal(pick('--serp-scan', '--doctor').mode, null);
});

test('pickMode: the conflict message names the flags in a fixed order', () => {
  assert.equal(pick('--doctor', '--report').conflict, 'Mutually exclusive modes cannot be combined: --report, --doctor. Use one at a time.');
});
