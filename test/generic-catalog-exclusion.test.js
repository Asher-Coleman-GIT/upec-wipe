// test/generic-catalog-exclusion.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadGenericBrokers } = require('../generic-runner');

test('generic pass skips subdomains of catalog domains', () => {
  // BADBOOL lists https://members.searchquarry.com/removeMyData
  const all = loadGenericBrokers(new Set());
  assert.ok(all.some(b => b.url.includes('members.searchquarry.com')), 'fixture site is in BADBOOL');
  const without = loadGenericBrokers(new Set(['searchquarry.com']));
  assert.ok(!without.some(b => b.url.includes('searchquarry.com')));
});
