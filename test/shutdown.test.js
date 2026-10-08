/**
 * test/shutdown.test.js
 *
 * M1 (final review): SIGINT/SIGTERM during a run or --confirm-emails awaits the
 * cleanup (close the browser session so the throwaway profile is deleted,
 * release the state lock) and then exits 130 / 143. Repeated signals run the
 * cleanup once. A fake process object stands in for the real one.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { installSignalCleanup } = require('../lib/shutdown');

function fakeProc() {
  const p = new EventEmitter();
  p.exits = [];
  return p;
}

test('SIGINT awaits cleanup then exits 130', async () => {
  const proc = fakeProc();
  const order = [];
  const h = installSignalCleanup({
    cleanup: async () => { await new Promise(r => setImmediate(r)); order.push('cleanup'); },
    proc,
    exit: (code) => { order.push(`exit ${code}`); },
  });
  proc.emit('SIGINT');
  await h.pending();
  assert.deepEqual(order, ['cleanup', 'exit 130']);
});

test('SIGTERM exits 143', async () => {
  const proc = fakeProc();
  const codes = [];
  const h = installSignalCleanup({ cleanup: async () => {}, proc, exit: (c) => codes.push(c) });
  proc.emit('SIGTERM');
  await h.pending();
  assert.deepEqual(codes, [143]);
});

test('idempotent: repeated signals run cleanup once and exit once', async () => {
  const proc = fakeProc();
  let cleanups = 0;
  const codes = [];
  const h = installSignalCleanup({ cleanup: async () => { cleanups += 1; }, proc, exit: (c) => codes.push(c) });
  proc.emit('SIGINT');
  proc.emit('SIGTERM');
  proc.emit('SIGINT');
  await h.pending();
  assert.equal(cleanups, 1);
  assert.deepEqual(codes, [130]);
});

test('a throwing cleanup still exits', async () => {
  const proc = fakeProc();
  const codes = [];
  const h = installSignalCleanup({ cleanup: async () => { throw new Error('boom'); }, proc, exit: (c) => codes.push(c) });
  proc.emit('SIGTERM');
  await h.pending();
  assert.deepEqual(codes, [143]);
});

test('uninstall removes the listeners', () => {
  const proc = fakeProc();
  const h = installSignalCleanup({ cleanup: async () => {}, proc, exit: () => {} });
  assert.equal(proc.listenerCount('SIGINT'), 1);
  assert.equal(proc.listenerCount('SIGTERM'), 1);
  h.uninstall();
  assert.equal(proc.listenerCount('SIGINT'), 0);
  assert.equal(proc.listenerCount('SIGTERM'), 0);
});

test('watcher.js installs the handler for the main run and --confirm-emails', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'watcher.js'), 'utf8');
  const uses = src.match(/installSignalCleanup\(/g) || [];
  assert.ok(uses.length >= 2, `expected >= 2 installSignalCleanup calls, got ${uses.length}`);
});
