/**
 * lib/egress.js
 *
 * Fail-closed check that browser traffic leaves through a VPN or proxy, so
 * brokers and search engines never see the member's home IP (which geolocates
 * to roughly the address being removed).
 *
 * - No network.proxy: the browser loads am.i.mullvad.net and must be on a
 *   Mullvad exit (Mullvad app, or Mullvad SOCKS5 configured system-wide).
 * - network.proxy set: Chromium uses that proxy, and the browser's public IP
 *   must differ from the machine's direct IP.
 * Anything unexpected is a failure. The home IP is never printed.
 */

'use strict';

const MULLVAD_CHECK_URL = 'https://am.i.mullvad.net/json';
const IP_ECHO_URL = 'https://api.ipify.org?format=json';
const PROXY_SCHEMES = ['socks5:', 'http:', 'https:'];

function egressRequired(config) {
  return !(config && config.network && config.network.required === false);
}

function proxyFromConfig(config) {
  const raw = config && config.network && typeof config.network.proxy === 'string' ? config.network.proxy.trim() : '';
  if (!raw) return null;
  let u;
  try { u = new URL(raw); } catch (_) { throw new Error(`network.proxy is not a valid URL: ${raw}`); }
  if (!PROXY_SCHEMES.includes(u.protocol)) {
    throw new Error(`network.proxy must start with socks5://, http:// or https:// (got ${u.protocol})`);
  }
  return { server: raw };
}

async function checkEgress({ config, fetchJsonInBrowser, fetchJsonDirect }) {
  if (!egressRequired(config)) {
    return { ok: true, mode: 'skipped', detail: 'network.required is false - brokers may see your real IP' };
  }
  let proxy;
  try { proxy = proxyFromConfig(config); } catch (err) { return { ok: false, mode: 'proxy', detail: err.message }; }

  if (!proxy) {
    try {
      const j = await fetchJsonInBrowser(MULLVAD_CHECK_URL);
      if (j && j.mullvad_exit_ip === true) return { ok: true, mode: 'mullvad', detail: `Mullvad exit (${j.country || 'unknown country'})` };
      return { ok: false, mode: 'mullvad', detail: 'Not connected through Mullvad. Connect the Mullvad app (with Lockdown mode on), or set network.proxy.' };
    } catch (err) {
      return { ok: false, mode: 'mullvad', detail: `Could not reach the Mullvad check page: ${err.message}` };
    }
  }

  try {
    const viaBrowser = await fetchJsonInBrowser(IP_ECHO_URL);
    const direct = await fetchJsonDirect(IP_ECHO_URL);
    const b = viaBrowser && typeof viaBrowser.ip === 'string' ? viaBrowser.ip : '';
    const d = direct && typeof direct.ip === 'string' ? direct.ip : '';
    if (!b || !d) return { ok: false, mode: 'proxy', detail: 'Could not determine both the proxied and the direct IP.' };
    if (b === d) return { ok: false, mode: 'proxy', detail: 'The browser exits from the same IP as this machine: network.proxy is not being used.' };
    return { ok: true, mode: 'proxy', detail: 'Browser traffic exits through the configured proxy.' };
  } catch (err) {
    return { ok: false, mode: 'proxy', detail: `Egress check failed: ${err.message}` };
  }
}

async function fetchJsonViaPage(context, url, timeoutMs) {
  const page = await context.newPage();
  try {
    const res = await page.goto(url, { timeout: timeoutMs || 20000, waitUntil: 'domcontentloaded' });
    return JSON.parse(await res.text());
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { egressRequired, proxyFromConfig, checkEgress, fetchJsonViaPage, MULLVAD_CHECK_URL, IP_ECHO_URL };
