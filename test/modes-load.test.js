'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { MODE_NAMES: MODES } = require('../lib/mode-dispatch');

test('every mode pickMode can return has a file with run()', () => {
  for (const m of MODES) {
    const mod = require(`../lib/modes/${m}`);
    assert.equal(typeof mod.run, 'function', m);
  }
});

test('watcher.js is a short entry point', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'watcher.js'), 'utf8');
  assert.ok(src.split('\n').length < 90, `watcher.js has ${src.split('\n').length} lines`);
  assert.match(src, /pickMode\(flags\)/);
});

test('the opt-out run does not call process.exit at its end', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'modes', 'run.js'), 'utf8');
  assert.match(src, /return main\(\);/);
});
