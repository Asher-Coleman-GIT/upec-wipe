/**
 * lib/browser-session.js
 *
 * One way to open the browser for this fork:
 * - a throwaway profile per launch (cookies and fingerprint state from broker
 *   sites do not accumulate across runs) unless browser.persistentProfile is true;
 * - the configured network.proxy;
 * - the fail-closed egress check before the caller gets the context.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildLaunchOptions } = require('./browser');
const { proxyFromConfig, checkEgress, fetchJsonViaPage, EgressError } = require('./egress');

function acquireProfileDir(config) {
  const persistent = !!(config && config.browser && config.browser.persistentProfile === true);
  if (persistent) {
    const dir = ((config && config.profileDir) || '~/.config/auto-identity-remove').replace(/^~(?=\/|$)/, os.homedir());
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return { dir, ephemeral: false, cleanup: () => {} };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidr-profile-'));
  fs.chmodSync(dir, 0o700);
  return { dir, ephemeral: true, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// Node's global fetch ignores HTTP(S)_PROXY env vars by default (Node 22), so this IP really is direct.
async function defaultFetchJsonDirect(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  return res.json();
}

async function openBrowserSession({ chromium, config, headless, needsNetwork = true, fetchJsonDirect, onProfile }) {
  const profile = acquireProfileDir(config);
  // Lets a signal handler remove the throwaway profile even while the browser is still launching.
  if (typeof onProfile === 'function') onProfile(profile);
  let proxy = null;
  try { proxy = proxyFromConfig(config); } catch (err) { profile.cleanup(); throw new EgressError(err.message); }

  let context;
  try {
    context = await chromium.launchPersistentContext(profile.dir, buildLaunchOptions({ headless, proxy: proxy || undefined }));
  } catch (err) {
    profile.cleanup();
    throw err;
  }
  const close = async () => {
    await context.close().catch(() => {});
    profile.cleanup();
  };

  if (needsNetwork) {
    const r = await checkEgress({
      config,
      fetchJsonInBrowser: (url) => fetchJsonViaPage(context, url),
      fetchJsonDirect: fetchJsonDirect || defaultFetchJsonDirect,
    });
    if (!r.ok) {
      await close();
      throw new EgressError(`Network check failed - nothing was submitted. ${r.detail}`);
    }
    console.log(`Network: ${r.detail}`);
  }
  return { context, close };
}

async function withBrowserSession(opts, fn) {
  const s = await openBrowserSession(opts);
  try {
    return await fn(s.context);
  } finally {
    await s.close();
  }
}

module.exports = { acquireProfileDir, openBrowserSession, withBrowserSession, EgressError };
