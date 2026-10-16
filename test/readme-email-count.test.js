'use strict';
/**
 * test/readme-email-count.test.js
 *
 * The README's coverage table says how many brokers `run --email` writes to.
 * Moving a broker to manual (it refused email, or its address bounced) changes
 * that number; this keeps the README honest.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadCatalog, catalogEmailTargets } = require('../lib/catalog');
const brokers = require('../brokers');

test('the README email-request count matches the catalog and brokers.js', () => {
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  const m = readme.match(/\| \*\*Email requests\*\* \(`run --email`\) \| (\d+) \| (\d+) catalog/);
  assert.ok(m, 'README has the Email requests row');
  const catalog = catalogEmailTargets(loadCatalog(undefined, () => {}), { explicitNames: new Set(brokers.map(b => b.name.toLowerCase())) }).length;
  const explicit = brokers.filter(b => b.method === 'email').length;
  assert.equal(Number(m[2]), catalog, 'catalog email brokers');
  assert.equal(Number(m[1]), catalog + explicit, 'total email requests');
});
