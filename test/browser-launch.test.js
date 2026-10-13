/**
 * test/browser-launch.test.js
 *
 * watcher.js launches Chromium from four separate places (main run, complaint
 * PDF rendering, --confirm-emails, report rendering). Three of them passed no
 * args at all, so container-hardening and anti-automation flags applied only to
 * the main run. lib/browser.js centralises the options so every launch site
 * gets the same treatment.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { watcherSource } = require('./helpers/watcher-source');
const fs = require('node:fs');
const path = require('node:path');

const { buildLaunchArgs, buildLaunchOptions, resolveHeadless } = require('../lib/browser');

test('buildLaunchArgs always includes the anti-automation flags', () => {
  const args = buildLaunchArgs({ platform: 'darwin' });
  assert.ok(args.includes('--no-first-run'));
  assert.ok(args.includes('--disable-blink-features=AutomationControlled'));
});

test('buildLaunchArgs adds container-safe flags on linux', () => {
  const args = buildLaunchArgs({ platform: 'linux' });
  // /dev/shm defaults to 64MB inside Docker; Chromium renderers die once they
  // fill it. --disable-dev-shm-usage moves shared memory to /tmp.
  assert.ok(args.includes('--disable-dev-shm-usage'), 'linux launches must not depend on a large /dev/shm');
});

test('buildLaunchArgs omits the linux-only flag on macOS', () => {
  // macOS has no /dev/shm limit to work around, and the flag costs performance.
  assert.ok(!buildLaunchArgs({ platform: 'darwin' }).includes('--disable-dev-shm-usage'));
});

test('buildLaunchArgs adds a low-memory profile when asked', () => {
  const lean = buildLaunchArgs({ platform: 'linux', lowMemory: true });
  assert.ok(lean.includes('--disable-dev-shm-usage'));
  assert.ok(lean.includes('--single-process') === false, '--single-process breaks Playwright; must not be used');
  for (const flag of ['--disable-gpu', '--disable-extensions', '--no-zygote']) {
    assert.ok(lean.includes(flag), `low-memory profile should include ${flag}`);
  }
});

test('buildLaunchArgs returns a fresh array each call', () => {
  const a = buildLaunchArgs({ platform: 'linux' });
  a.push('--mutated');
  assert.ok(!buildLaunchArgs({ platform: 'linux' }).includes('--mutated'));
});

test('buildLaunchOptions carries viewport, args and ignoreDefaultArgs', () => {
  const opts = buildLaunchOptions({ platform: 'linux', headless: true });
  assert.equal(opts.headless, true);
  assert.deepEqual(opts.viewport, { width: 1280, height: 900 });
  assert.ok(opts.args.includes('--disable-dev-shm-usage'));
  assert.deepEqual(opts.ignoreDefaultArgs, ['--enable-automation']);
});

test('resolveHeadless honours an explicit HEADLESS env value', () => {
  for (const v of ['1', 'true', 'TRUE']) {
    assert.equal(resolveHeadless({ HEADLESS: v }, 'darwin'), true, `HEADLESS=${v} should force headless`);
  }
  for (const v of ['0', 'false', 'FALSE']) {
    assert.equal(resolveHeadless({ HEADLESS: v }, 'linux'), false, `HEADLESS=${v} should force headed`);
  }
});

test('resolveHeadless auto-detects headless for a linux box with no DISPLAY', () => {
  assert.equal(resolveHeadless({}, 'linux'), true);
  assert.equal(resolveHeadless({ DISPLAY: ':0' }, 'linux'), false);
  assert.equal(resolveHeadless({}, 'darwin'), false);
});

test('every chromium launch site in watcher.js goes through lib/browser-session', () => {
  const watcher = watcherSource();
  assert.equal(
    (watcher.match(/launchPersistentContext\(/g) || []).length,
    0,
    'watcher.js must not launch Chromium directly; use openBrowserSession (ephemeral profile, proxy, egress check)',
  );
  const sessions = watcher.match(/openBrowserSession\(/g) || [];
  assert.ok(sessions.length >= 1, `expected the run's session launch site, found ${sessions.length}`);

  const session = fs.readFileSync(path.join(__dirname, '..', 'lib', 'browser-session.js'), 'utf8');
  assert.match(session, /launchPersistentContext\([^)]*buildLaunchOptions\(/,
    'the session helper must build its options via buildLaunchOptions() so container flags are never lost');
});

test('buildLaunchOptions passes a proxy and blocks non-proxied WebRTC', () => {
  const o = buildLaunchOptions({ headless: true, platform: 'linux', env: {}, proxy: { server: 'socks5://10.64.0.1:1080' } });
  assert.deepEqual(o.proxy, { server: 'socks5://10.64.0.1:1080' });
  assert.ok(o.args.includes('--force-webrtc-ip-handling-policy=disable_non_proxied_udp'));
});

test('buildLaunchOptions without proxy has no proxy key', () => {
  const o = buildLaunchOptions({ headless: true, platform: 'linux', env: {} });
  assert.equal('proxy' in o, false);
  assert.ok(o.args.includes('--force-webrtc-ip-handling-policy=disable_non_proxied_udp'), 'L10: WebRTC policy is always set');
  assert.equal(o.args.some(a => a.startsWith('--host-resolver-rules')), false, 'no resolver rules without a proxy');
});

test('L13: a proxy adds host-resolver-rules that exclude only the proxy host', () => {
  const o = buildLaunchOptions({ headless: true, platform: 'linux', env: {}, proxy: { server: 'socks5://proxy.example.net:1080' } });
  assert.ok(o.args.includes('--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE proxy.example.net'));
  const o2 = buildLaunchOptions({ headless: true, platform: 'linux', env: {}, proxy: { server: 'http://10.64.0.1:8080' } });
  assert.ok(o2.args.includes('--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 10.64.0.1'));
});
