/**
 * test/feeds-https-cap.test.js
 *
 * Audit M6 (follow-up C1 item 7). Registry rows decide where the generic pass
 * sends name, alias, state and zip. A plain http:// row sent them in clear
 * text, an unbounded response could exhaust memory, and CA_REGISTRY_URL /
 * VT_REGISTRY_URL could point the feed anywhere.
 *
 * - Rows whose URL is not https after normalisation are dropped; the count is
 *   printed, the URLs are not. Rows with no URL stay (manual, never navigated).
 * - Response bodies over 5 MB are rejected (content-length and while streaming).
 * - Env overrides are honoured only when they are https URLs.
 *
 * No real network: every fetch is an injected fake.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MB = 1024 * 1024;

function freshFeeds(env) {
  const saved = {};
  for (const k of ['CA_REGISTRY_URL', 'VT_REGISTRY_URL']) {
    saved[k] = process.env[k];
    if (env && env[k] !== undefined) process.env[k] = env[k]; else delete process.env[k];
  }
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  delete require.cache[require.resolve('../lib/feeds')];
  let feeds;
  try { feeds = require('../lib/feeds'); } finally {
    console.warn = origWarn;
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
  return { feeds, warnings };
}

const CSV = [
  'Name,Website',
  'Secure Co,https://secure.example/opt-out',
  'Bare Co,bare.example/remove',
  'Plain Co,http://evil.example/optout?leak=1',
  'Upper Co,HTTP://shout.example/x',
  'Manual Co,',
].join('\n');

function textFetch(body) {
  return async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => body });
}

test('fetchCaRegistry drops non-https rows and prints only the count', async () => {
  const { feeds } = freshFeeds();
  const logs = [];
  const rows = await feeds.fetchCaRegistry({ fetchImpl: textFetch(CSV), url: 'https://ca.test/r.csv', logFn: (m) => logs.push(m) });
  const names = rows.map(r => r.name).sort();
  assert.deepEqual(names, ['Bare Co', 'Manual Co', 'Secure Co']);
  for (const r of rows) assert.ok(r.optOutUrl === '' || r.optOutUrl.startsWith('https://'), r.optOutUrl);
  const out = logs.join('\n');
  assert.match(out, /\b2\b/);
  assert.match(out, /not https/);
  assert.doesNotMatch(out, /evil\.example|shout\.example|http:\/\//i);
});

test('fetchVtRegistry drops non-https rows too', async () => {
  const { feeds } = freshFeeds();
  const logs = [];
  const rows = await feeds.fetchVtRegistry({ fetchImpl: textFetch(CSV), url: 'https://vt.test/r.csv', logFn: (m) => logs.push(m) });
  assert.equal(rows.some(r => /^http:/i.test(r.optOutUrl)), false);
  assert.equal(rows.length, 3);
});

test('no message when nothing is dropped', async () => {
  const { feeds } = freshFeeds();
  const logs = [];
  await feeds.fetchCaRegistry({ fetchImpl: textFetch('Name,Website\nA,https://a.example/\n'), url: 'https://ca.test/r.csv', logFn: (m) => logs.push(m) });
  assert.deepEqual(logs, []);
});

test('a content-length over 5 MB is rejected before the body is read', async () => {
  const { feeds } = freshFeeds();
  let read = false;
  const fetchImpl = async () => ({
    ok: true, status: 200,
    headers: { get: (h) => (h.toLowerCase() === 'content-length' ? String(6 * MB) : null) },
    text: async () => { read = true; return ''; },
  });
  await assert.rejects(() => feeds.fetchCaRegistry({ fetchImpl, url: 'https://ca.test/r.csv' }), /5 MB/);
  assert.equal(read, false);
});

test('a streamed body over 5 MB without content-length is rejected', async () => {
  const { feeds } = freshFeeds();
  let pulled = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulled += 1;
      if (pulled > 50) { controller.close(); return; }
      controller.enqueue(new Uint8Array(MB).fill(65));
    },
  });
  const fetchImpl = async () => new Response(stream, { status: 200 });
  await assert.rejects(() => feeds.fetchCaRegistry({ fetchImpl, url: 'https://ca.test/r.csv' }), /5 MB/);
  assert.ok(pulled < 20, `stopped reading early (pulled ${pulled} MB)`);
});

test('a text-only body over 5 MB is rejected', async () => {
  const { feeds } = freshFeeds();
  const big = 'Name,Website\n' + 'x'.repeat(5 * MB + 10);
  await assert.rejects(() => feeds.fetchCaRegistry({ fetchImpl: textFetch(big), url: 'https://ca.test/r.csv' }), /5 MB/);
});

test('a streamed body under the cap is read normally', async () => {
  const { feeds } = freshFeeds();
  const fetchImpl = async () => new Response('Name,Website\nA,https://a.example/opt-out\n', { status: 200 });
  const rows = await feeds.fetchCaRegistry({ fetchImpl, url: 'https://ca.test/r.csv' });
  assert.equal(rows.length, 1);
});

test('an http env override is ignored with a warning; the default is used', () => {
  const { feeds: defaults } = freshFeeds();
  const { feeds, warnings } = freshFeeds({ CA_REGISTRY_URL: 'http://evil.example/ca.csv', VT_REGISTRY_URL: 'file:///etc/passwd' });
  assert.equal(feeds.CA_REGISTRY_URL, defaults.CA_REGISTRY_URL);
  assert.equal(feeds.VT_REGISTRY_URL, defaults.VT_REGISTRY_URL);
  assert.ok(feeds.CA_REGISTRY_URL.startsWith('https://'));
  const out = warnings.join('\n');
  assert.match(out, /CA_REGISTRY_URL/);
  assert.match(out, /VT_REGISTRY_URL/);
  assert.doesNotMatch(out, /evil\.example/);
});

test('an https env override is honoured without a warning', () => {
  const { feeds, warnings } = freshFeeds({ CA_REGISTRY_URL: 'https://ca.test/x.csv' });
  assert.equal(feeds.CA_REGISTRY_URL, 'https://ca.test/x.csv');
  assert.deepEqual(warnings, []);
});
