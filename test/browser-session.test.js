/**
 * test/browser-session.test.js
 *
 * Every browser launch uses a throwaway profile (unless opted out), the
 * configured proxy, and the egress check. Failure or a crash in the caller must
 * still close the browser and delete the profile.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { acquireProfileDir, openBrowserSession, withBrowserSession, EgressError } = require('../lib/browser-session');

function fakeChromium(json) {
  const calls = { launches: [], closed: 0 };
  return {
    calls,
    launchPersistentContext: async (dir, opts) => {
      calls.launches.push({ dir, opts });
      return {
        newPage: async () => ({ goto: async () => ({ text: async () => JSON.stringify(json) }), close: async () => {} }),
        close: async () => { calls.closed += 1; },
      };
    },
  };
}

test('default profile is a fresh 0700 temp dir that cleanup removes', () => {
  const p = acquireProfileDir({});
  assert.equal(p.ephemeral, true);
  assert.ok(p.dir.startsWith(os.tmpdir()));
  if (process.platform !== 'win32') assert.equal(fs.statSync(p.dir).mode & 0o777, 0o700);
  p.cleanup();
  assert.equal(fs.existsSync(p.dir), false);
});

test('browser.persistentProfile true uses profileDir and never deletes it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidr-keep-'));
  const p = acquireProfileDir({ browser: { persistentProfile: true }, profileDir: dir });
  assert.equal(p.ephemeral, false);
  assert.equal(p.dir, dir);
  p.cleanup();
  assert.equal(fs.existsSync(dir), true);
});

test('passing egress check yields a context; close removes the profile', async () => {
  const chromium = fakeChromium({ mullvad_exit_ip: true, country: 'Sweden' });
  const s = await openBrowserSession({ chromium, config: {}, headless: true });
  const dir = chromium.calls.launches[0].dir;
  assert.ok(fs.existsSync(dir));
  await s.close();
  assert.equal(chromium.calls.closed, 1);
  assert.equal(fs.existsSync(dir), false);
});

test('failing egress check throws EgressError, closes the browser and removes the profile', async () => {
  const chromium = fakeChromium({ mullvad_exit_ip: false });
  await assert.rejects(() => openBrowserSession({ chromium, config: {}, headless: true }), EgressError);
  assert.equal(chromium.calls.closed, 1);
  assert.equal(fs.existsSync(chromium.calls.launches[0].dir), false);
});

test('proxy from config reaches the launch options', async () => {
  const chromium = fakeChromium({ ip: '185.65.1.1' });
  const s = await openBrowserSession({
    chromium, config: { network: { proxy: 'socks5://10.64.0.1:1080' } }, headless: true,
    fetchJsonDirect: async () => ({ ip: '73.1.1.1' }),
  });
  assert.deepEqual(chromium.calls.launches[0].opts.proxy, { server: 'socks5://10.64.0.1:1080' });
  await s.close();
});

test('needsNetwork false skips the check (local PDF rendering)', async () => {
  const chromium = fakeChromium({ mullvad_exit_ip: false });
  const s = await openBrowserSession({ chromium, config: {}, headless: true, needsNetwork: false });
  await s.close();
});

test('withBrowserSession cleans up when the body throws', async () => {
  const chromium = fakeChromium({ mullvad_exit_ip: true });
  await assert.rejects(() => withBrowserSession({ chromium, config: {}, headless: true }, async () => { throw new Error('crash'); }), /crash/);
  assert.equal(chromium.calls.closed, 1);
  assert.equal(fs.existsSync(chromium.calls.launches[0].dir), false);
});

test('close() is idempotent: a second call is safe and the profile stays removed', async () => {
  const chromium = fakeChromium({ mullvad_exit_ip: true });
  const s = await openBrowserSession({ chromium, config: {}, headless: true });
  const dir = chromium.calls.launches[0].dir;
  await s.close();
  await s.close();
  assert.equal(fs.existsSync(dir), false);
});
