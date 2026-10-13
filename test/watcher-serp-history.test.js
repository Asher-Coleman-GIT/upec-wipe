'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { watcherSource } = require('./helpers/watcher-source');

test('watcher never builds the SERP history path by hand', () => {
  // lib/modes/clear.js names the file only to delete it, from an injected root.
  const fs = require('node:fs');
  const clear = fs.readFileSync(require('node:path').join(__dirname, '..', 'lib', 'modes', 'clear.js'), 'utf8');
  const src = watcherSource().replace(clear, '');
  assert.ok(!/serp-history\.json'\)/.test(src), 'no hand-built serp-history.json path');
});
