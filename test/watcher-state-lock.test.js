'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'watcher.js'), 'utf8');
const between = (a, b) => src.slice(src.indexOf(a), src.indexOf(b));

test('--list reads the catalog once (about 2.5 s per read on /mnt/c)', () => {
  const block = between('if (LIST_MODE) {', "if (process.argv.includes('--reply'))");
  assert.equal((block.match(/loadCatalog\(/g) || []).length, 1);
});

test('reply takes the state lock and reloads state under it', () => {
  const block = between("if (process.argv.includes('--reply'))", 'if (SCORE_MODE) {');
  assert.match(block, /acquireStateLockOrExit\(\)/);
  assert.match(block, /resetState\(\)/);
});

test('the lock-or-exit code exists once', () => {
  assert.equal((src.match(/Another instance is running/g) || []).length, 1);
});
