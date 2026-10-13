'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatFatal } = require('../lib/modes/shared');
const { _clickDoNotSell } = require('../generic-runner');

test('a fatal error prints one line, plus the stack only with UPEC_WIPE_DEBUG', () => {
  const err = new Error('boom');
  assert.equal(formatFatal(err, {}), '\nFatal: boom');
  const dbg = formatFatal(err, { UPEC_WIPE_DEBUG: '1' });
  assert.ok(dbg.startsWith('\nFatal: boom\n'));
  assert.match(dbg, /at /);
});

test('a failed generic click is shown under UPEC_WIPE_DEBUG, with URLs redacted', async () => {
  const el = { first: () => el, count: async () => 1, click: async () => { throw new Error('click failed at https://broker.example/opt-out?first=Jane'); } };
  const page = { locator: () => el, waitForTimeout: async () => {} };
  const warned = [];
  const realWarn = console.warn;
  const had = process.env.UPEC_WIPE_DEBUG;
  console.warn = (...a) => warned.push(a.join(' '));
  process.env.UPEC_WIPE_DEBUG = '1';
  try {
    assert.equal(await _clickDoNotSell(page), false);
  } finally {
    console.warn = realWarn;
    if (had === undefined) delete process.env.UPEC_WIPE_DEBUG; else process.env.UPEC_WIPE_DEBUG = had;
  }
  assert.equal(warned.length, 1);
  assert.match(warned[0], /\[generic\] Do Not Sell click failed/);
  assert.ok(!warned[0].includes('Jane'), 'no personal data in the debug line');
});

test('without UPEC_WIPE_DEBUG a failed click stays quiet', async () => {
  const el = { first: () => el, count: async () => 1, click: async () => { throw new Error('x'); } };
  const page = { locator: () => el, waitForTimeout: async () => {} };
  const warned = [];
  const realWarn = console.warn;
  const had = process.env.UPEC_WIPE_DEBUG;
  console.warn = (...a) => warned.push(a.join(' '));
  delete process.env.UPEC_WIPE_DEBUG;
  try {
    await _clickDoNotSell(page);
  } finally {
    console.warn = realWarn;
    if (had !== undefined) process.env.UPEC_WIPE_DEBUG = had;
  }
  assert.equal(warned.length, 0);
});
