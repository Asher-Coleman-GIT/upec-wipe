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

test('idempotent: repeated signals run cleanup once', async () => {
  const proc = fakeProc();
  let cleanups = 0;
  const h = installSignalCleanup({ cleanup: async () => { cleanups += 1; }, proc, exit: () => {} });
  proc.emit('SIGINT');
  proc.emit('SIGTERM');
  proc.emit('SIGINT');
  await h.pending();
  assert.equal(cleanups, 1);
});

test('a second signal while cleanup hangs runs syncCleanup and exits immediately with that signal code', async () => {
  const proc = fakeProc();
  const events = [];
  installSignalCleanup({
    cleanup: () => new Promise(() => {}), // never settles
    syncCleanup: () => events.push('sync'),
    timeoutMs: 60000,
    proc,
    exit: (c) => events.push(`exit ${c}`),
  });
  proc.emit('SIGINT');
  assert.deepEqual(events, []);
  proc.emit('SIGTERM');
  assert.deepEqual(events, ['sync', 'exit 143']);
  proc.emit('SIGINT'); // further signals are inert once exiting
  assert.deepEqual(events, ['sync', 'exit 143']);
});

test('a throwing syncCleanup on the second signal still exits', () => {
  const proc = fakeProc();
  const codes = [];
  installSignalCleanup({
    cleanup: () => new Promise(() => {}),
    syncCleanup: () => { throw new Error('boom'); },
    timeoutMs: 60000,
    proc,
    exit: (c) => codes.push(c),
  });
  proc.emit('SIGTERM');
  proc.emit('SIGTERM');
  assert.deepEqual(codes, [143]);
});

test('a hung cleanup times out: syncCleanup runs and the process exits with the first signal code', async () => {
  const proc = fakeProc();
  const events = [];
  const h = installSignalCleanup({
    cleanup: () => new Promise(() => {}),
    syncCleanup: () => events.push('sync'),
    timeoutMs: 20,
    proc,
    exit: (c) => events.push(`exit ${c}`),
  });
  proc.emit('SIGINT');
  await h.pending();
  assert.deepEqual(events, ['sync', 'exit 130']);
});

test('a cleanup that finishes in time does not run syncCleanup', async () => {
  const proc = fakeProc();
  const events = [];
  const h = installSignalCleanup({
    cleanup: async () => { events.push('cleanup'); },
    syncCleanup: () => events.push('sync'),
    timeoutMs: 20,
    proc,
    exit: (c) => events.push(`exit ${c}`),
  });
  proc.emit('SIGINT');
  await h.pending();
  await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(events, ['cleanup', 'exit 130']);
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
  const src = require('./helpers/watcher-source').watcherSource();
  const uses = src.match(/installSignalCleanup\(/g) || [];
  assert.ok(uses.length >= 2, `expected >= 2 installSignalCleanup calls, got ${uses.length}`);
});

test('watcher.js --confirm-emails registers the profile cleanup before the browser launches', () => {
  const src = require('./helpers/watcher-source').modeSource('confirm-emails');
  const i = src.indexOf('chromium: chromiumForConfirm, config');
  assert.ok(i > 0);
  assert.match(src.slice(i, i + 200), /onProfile/);
  assert.match(src.slice(0, i), /syncCleanup/);
});

test('openBrowserSession reports the profile via onProfile before launch, so a signal during launch can clean it', async () => {
  const fs = require('fs');
  const { openBrowserSession } = require('../lib/browser-session');
  let seen = null;
  const chromium = {
    launchPersistentContext: async (dir) => {
      assert.ok(seen && seen.dir === dir, 'onProfile must fire before launch');
      assert.ok(fs.existsSync(dir));
      throw new Error('launch failed');
    },
  };
  await assert.rejects(
    openBrowserSession({ chromium, config: {}, headless: true, needsNetwork: false, onProfile: (p) => { seen = p; } }),
    /launch failed/
  );
  assert.ok(seen && typeof seen.cleanup === 'function');
  assert.equal(fs.existsSync(seen.dir), false);
});
