/**
 * test/feeds-fetch.test.js
 *
 * Tests fetchCaRegistry / fetchVtRegistry / buildFeedsFile with an injected
 * fetchImpl that returns inline CSV. No real network is used.
 */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { fetchCaRegistry, fetchVtRegistry, buildFeedsFile } = require('../lib/feeds');

// A fetch stub: maps a URL -> CSV text. Mirrors the WHATWG fetch Response shape
// just enough (ok, status, text()).
function makeFetch(byUrl) {
  return async (url) => {
    if (!(url in byUrl)) {
      return { ok: false, status: 404, text: async () => '' };
    }
    const body = byUrl[url];
    return { ok: true, status: 200, text: async () => body };
  };
}

const CA_CSV =
  'Data Broker Name,Website URL\n' +
  'Acme Data Co,https://acme.example.com/opt-out\n' +
  'Beta Brokers LLC,https://beta.example.com/\n';

const VT_CSV =
  'Business Name,Website\n' +
  'Gamma Insights,https://gamma.example.com/do-not-sell\n' +
  'Acme Data Co,https://acme.example.com/optout\n';  // duplicate host with CA

test('fetchCaRegistry parses injected CSV into ca-sourced broker entries', async () => {
  const fetchImpl = makeFetch({ 'https://ca.test/registry.csv': CA_CSV });
  const brokers = await fetchCaRegistry({ fetchImpl, url: 'https://ca.test/registry.csv' });
  assert.equal(brokers.length, 2);
  assert.equal(brokers[0].name, 'Acme Data Co');
  assert.equal(brokers[0].method, 'direct-form');
  assert.equal(brokers[0].source, 'ca');
  assert.equal(brokers[1].name, 'Beta Brokers LLC');
  assert.equal(brokers[1].method, 'manual');
});

test('fetchVtRegistry tags entries with source vt', async () => {
  const fetchImpl = makeFetch({ 'https://vt.test/registry.csv': VT_CSV });
  const brokers = await fetchVtRegistry({ fetchImpl, url: 'https://vt.test/registry.csv' });
  assert.equal(brokers.length, 2);
  assert.ok(brokers.every(b => b.source === 'vt'));
  assert.equal(brokers[0].name, 'Gamma Insights');
  assert.equal(brokers[0].method, 'direct-form');
});

test('fetchCaRegistry throws a descriptive error on non-OK responses', async () => {
  const fetchImpl = makeFetch({});  // any URL -> 404
  await assert.rejects(
    () => fetchCaRegistry({ fetchImpl, url: 'https://ca.test/missing.csv' }),
    /Feed fetch failed.*HTTP 404/,
  );
});

test('buildFeedsFile merges both registries and dedups across them and explicit hosts', async () => {
  const fetchImpl = makeFetch({
    'https://ca.test/registry.csv': CA_CSV,
    'https://vt.test/registry.csv': VT_CSV,
  });
  // Override URLs via the dedicated fetch fns by passing url through buildFeedsFile?
  // buildFeedsFile uses default URLs, so we exercise it via env override instead.
  process.env.CA_REGISTRY_URL = 'https://ca.test/registry.csv';
  process.env.VT_REGISTRY_URL = 'https://vt.test/registry.csv';
  delete require.cache[require.resolve('../lib/feeds')];
  const feeds = require('../lib/feeds');
  try {
    const result = await feeds.buildFeedsFile({
      fetchImpl,
      explicitHosts: ['beta.example.com'],  // collides with CA "Beta Brokers LLC"
    });
    // CA: Acme + Beta (2). VT: Gamma + Acme-dup (2).
    // Dedup: Beta dropped (explicit), VT Acme dropped (dup of CA Acme).
    // Survivors: Acme (ca), Gamma (vt) = 2.
    assert.equal(result.stats.ca, 2);
    assert.equal(result.stats.vt, 2);
    assert.equal(result.stats.total, 2);
    const names = result.brokers.map(b => b.name).sort();
    assert.deepEqual(names, ['Acme Data Co', 'Gamma Insights']);
    const acme = result.brokers.find(b => b.name === 'Acme Data Co');
    assert.equal(acme.source, 'ca');  // CA wins because it is merged first
  } finally {
    delete process.env.CA_REGISTRY_URL;
    delete process.env.VT_REGISTRY_URL;
    delete require.cache[require.resolve('../lib/feeds')];
  }
});

test('buildFeedsFile returns empty brokers when both registries are empty', async () => {
  const empty = 'Name,Website\n';
  const fetchImpl = makeFetch({
    'https://ca.test/empty.csv': empty,
    'https://vt.test/empty.csv': empty,
  });
  process.env.CA_REGISTRY_URL = 'https://ca.test/empty.csv';
  process.env.VT_REGISTRY_URL = 'https://vt.test/empty.csv';
  delete require.cache[require.resolve('../lib/feeds')];
  const feeds = require('../lib/feeds');
  try {
    const result = await feeds.buildFeedsFile({ fetchImpl, explicitHosts: [] });
    assert.deepEqual(result.brokers, []);
    assert.equal(result.stats.total, 0);
  } finally {
    delete process.env.CA_REGISTRY_URL;
    delete process.env.VT_REGISTRY_URL;
    delete require.cache[require.resolve('../lib/feeds')];
  }
});

// 2026-10-16: Vermont's bizfilings site was rebuilt; the old export address
// serves the app's front page, the public search needs a reCAPTCHA token per
// request and the bulk download a login. With no public file, Vermont is
// skipped without a request unless VT_REGISTRY_URL names one.
test('without VT_REGISTRY_URL Vermont is skipped with a reason and nothing is fetched for it', async () => {
  const fetched = [];
  const fetchImpl = async (url) => { fetched.push(url); return { ok: true, status: 200, headers: { get: () => null }, text: async () => 'Name,Website\n' }; };
  delete process.env.VT_REGISTRY_URL;
  process.env.CA_REGISTRY_URL = 'https://ca.test/registry.csv';
  delete require.cache[require.resolve('../lib/feeds')];
  const feeds = require('../lib/feeds');
  const logged = [];
  try {
    const result = await feeds.buildFeedsFile({ fetchImpl, explicitHosts: [], logFn: (m) => logged.push(m) });
    assert.deepEqual(fetched, ['https://ca.test/registry.csv']);
    assert.equal(result.stats.vt, 0);
    assert.match(logged.join('\n'), /Vermont .*no public download/i);
    assert.match(logged.join('\n'), /VT_REGISTRY_URL/);
  } finally {
    delete process.env.CA_REGISTRY_URL;
    delete require.cache[require.resolve('../lib/feeds')];
  }
});
