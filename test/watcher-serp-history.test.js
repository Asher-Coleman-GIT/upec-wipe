'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { watcherSource } = require('./helpers/watcher-source');

test('watcher never builds the SERP history path by hand', () => {
  const src = watcherSource();
  assert.ok(!/serp-history\.json'\)/.test(src), 'no hand-built serp-history.json path');
});
