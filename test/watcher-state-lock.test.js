'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { watcherSource, modeSource } = require('./helpers/watcher-source');

test('--list reads the catalog once (about 2.5 s per read on /mnt/c)', () => {
  assert.equal((modeSource('list').match(/loadCatalog\(/g) || []).length, 1);
});

test('reply takes the state lock and reloads state under it', () => {
  const block = modeSource('reply');
  assert.match(block, /acquireStateLockOrExit\(\)/);
  assert.match(block, /resetState\(\)/);
});

test('the lock-or-exit code exists once', () => {
  assert.equal((watcherSource().match(/Another instance is running/g) || []).length, 1);
});
