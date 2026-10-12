'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { watcherSource } = require('./helpers/watcher-source');

test('watcher reads the SERP history only through serp-scan readHistory()', () => {
  const src = watcherSource();
  assert.ok(!/serp-history\.json'\)/.test(src), 'no hand-built serp-history.json path');
  assert.equal((src.match(/readHistory\(\)/g) || []).length, 2);
});
