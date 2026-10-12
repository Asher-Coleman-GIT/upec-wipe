'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('watcher reads the SERP history only through serp-scan readHistory()', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'watcher.js'), 'utf8');
  assert.ok(!/serp-history\.json'\)/.test(src), 'no hand-built serp-history.json path');
  assert.equal((src.match(/readHistory\(\)/g) || []).length, 2);
});
