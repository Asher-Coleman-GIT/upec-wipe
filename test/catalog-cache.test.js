'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { cachedCatalogLoader } = require('../lib/catalog');

test('the catalog is read once per TTL', () => {
  let t = 0;
  let reads = 0;
  const get = cachedCatalogLoader({ ttlMs: 60000, now: () => t, load: () => { reads++; return [{ domain: `r${reads}.example` }]; } });
  assert.equal(get()[0].domain, 'r1.example');
  t += 59999;
  assert.equal(get()[0].domain, 'r1.example');
  assert.equal(reads, 1);
  t += 1;
  assert.equal(get()[0].domain, 'r2.example');
  assert.equal(reads, 2);
});

test('the dashboard reads the catalog through the cache', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'server.js'), 'utf8');
  assert.match(src, /cachedCatalogLoader\(/);
  assert.ok(!/loadCatalog\(/.test(src), 'server.js must not read the catalog directly');
});

test('the default TTL is one minute', () => {
  let t = 0;
  let reads = 0;
  const get = cachedCatalogLoader({ now: () => t, load: () => { reads++; return []; } });
  get();
  t += 59999;
  get();
  assert.equal(reads, 1);
  t += 1;
  get();
  assert.equal(reads, 2);
});

test('a clock that jumps backwards (WSL after the host sleeps) forces a fresh read', () => {
  let t = 1000000;
  let reads = 0;
  const get = cachedCatalogLoader({ now: () => t, load: () => { reads++; return []; } });
  get();
  t -= 3600000;
  get();
  assert.equal(reads, 2);
});
