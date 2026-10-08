/**
 * test/egress.test.js
 *
 * Brokers and search engines must not see the member's home IP. The check runs
 * through the browser itself and fails closed on anything unexpected.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  egressRequired, proxyFromConfig, checkEgress, fetchJsonViaPage, MULLVAD_CHECK_URL, IP_ECHO_URL,
} = require('../lib/egress');

const never = async () => { throw new Error('should not be called'); };

test('egress is required by default and only disabled by an explicit false', () => {
  assert.equal(egressRequired({}), true);
  assert.equal(egressRequired({ network: {} }), true);
  assert.equal(egressRequired({ network: { required: 'false' } }), true);
  assert.equal(egressRequired({ network: { required: false } }), false);
});

test('proxyFromConfig accepts socks5/http/https and rejects others', () => {
  assert.equal(proxyFromConfig({}), null);
  assert.equal(proxyFromConfig({ network: { proxy: '' } }), null);
  assert.deepEqual(proxyFromConfig({ network: { proxy: 'socks5://10.64.0.1:1080' } }), { server: 'socks5://10.64.0.1:1080' });
  assert.deepEqual(proxyFromConfig({ network: { proxy: 'http://127.0.0.1:8118' } }), { server: 'http://127.0.0.1:8118' });
  assert.throws(() => proxyFromConfig({ network: { proxy: 'ftp://x:1' } }), /network\.proxy/);
  assert.throws(() => proxyFromConfig({ network: { proxy: 'not a url' } }), /network\.proxy/);
});

test('mullvad mode: ok only when mullvad_exit_ip === true', async () => {
  const seen = [];
  const yes = await checkEgress({ config: {}, fetchJsonInBrowser: async (u) => { seen.push(u); return { ip: '1.2.3.4', mullvad_exit_ip: true }; }, fetchJsonDirect: never });
  assert.equal(yes.ok, true);
  assert.equal(yes.mode, 'mullvad');
  assert.deepEqual(seen, [MULLVAD_CHECK_URL]);
  const no = await checkEgress({ config: {}, fetchJsonInBrowser: async () => ({ ip: '1.2.3.4', mullvad_exit_ip: false }), fetchJsonDirect: never });
  assert.equal(no.ok, false);
  assert.match(no.detail, /Mullvad/);
  const truthy = await checkEgress({ config: {}, fetchJsonInBrowser: async () => ({ mullvad_exit_ip: 'true' }), fetchJsonDirect: never });
  assert.equal(truthy.ok, false, 'string "true" is not accepted');
});

test('mullvad mode: network error or garbage fails closed', async () => {
  const err = await checkEgress({ config: {}, fetchJsonInBrowser: async () => { throw new Error('net::ERR_NAME_NOT_RESOLVED'); }, fetchJsonDirect: never });
  assert.equal(err.ok, false);
  assert.match(err.detail, /ERR_NAME_NOT_RESOLVED/);
  const junk = await checkEgress({ config: {}, fetchJsonInBrowser: async () => null, fetchJsonDirect: never });
  assert.equal(junk.ok, false);
});

test('proxy mode: ok only when browser IP differs from direct IP', async () => {
  const cfg = { network: { proxy: 'socks5://10.64.0.1:1080' } };
  const seen = [];
  const ok = await checkEgress({
    config: cfg,
    fetchJsonInBrowser: async (u) => { seen.push(['b', u]); return { ip: '185.65.1.1' }; },
    fetchJsonDirect: async (u) => { seen.push(['d', u]); return { ip: '73.10.10.10' }; },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.mode, 'proxy');
  assert.deepEqual(seen, [['b', IP_ECHO_URL], ['d', IP_ECHO_URL]]);
  const same = await checkEgress({ config: cfg, fetchJsonInBrowser: async () => ({ ip: '73.10.10.10' }), fetchJsonDirect: async () => ({ ip: '73.10.10.10' }) });
  assert.equal(same.ok, false);
  assert.ok(!same.detail.includes('73.10.10.10'), 'never print the home IP');
  const missing = await checkEgress({ config: cfg, fetchJsonInBrowser: async () => ({}), fetchJsonDirect: async () => ({ ip: '1.1.1.1' }) });
  assert.equal(missing.ok, false);
  const directDown = await checkEgress({ config: cfg, fetchJsonInBrowser: async () => ({ ip: '185.65.1.1' }), fetchJsonDirect: async () => { throw new Error('offline'); } });
  assert.equal(directDown.ok, false);
});

test('network.required false skips the check', async () => {
  const r = await checkEgress({ config: { network: { required: false } }, fetchJsonInBrowser: never, fetchJsonDirect: never });
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'skipped');
});

test('invalid proxy config fails closed instead of throwing', async () => {
  const r = await checkEgress({ config: { network: { proxy: 'ftp://x:1' } }, fetchJsonInBrowser: never, fetchJsonDirect: never });
  assert.equal(r.ok, false);
  assert.match(r.detail, /network\.proxy/);
});

test('fetchJsonViaPage parses the body and always closes the page', async () => {
  let closed = 0;
  const mkCtx = (text, gotoThrows) => ({
    newPage: async () => ({
      goto: async () => { if (gotoThrows) throw new Error('boom'); return { text: async () => text }; },
      close: async () => { closed += 1; },
    }),
  });
  assert.deepEqual(await fetchJsonViaPage(mkCtx('{"ip":"1.2.3.4"}'), IP_ECHO_URL), { ip: '1.2.3.4' });
  await assert.rejects(() => fetchJsonViaPage(mkCtx('<html>'), IP_ECHO_URL));
  await assert.rejects(() => fetchJsonViaPage(mkCtx('', true), IP_ECHO_URL), /boom/);
  assert.equal(closed, 3);
});
