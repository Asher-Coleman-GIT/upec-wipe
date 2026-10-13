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

test('the fatal output never names the account or carries a URL query', () => {
  const err = new Error('failed at https://broker.example/opt-out?first=Jane');
  err.stack = [
    'Error: failed at https://broker.example/opt-out?first=Jane',
    '    at run (/home/janedoe/upec/lib/modes/run.js:10:5)',
    '    at main (C:\\Users\\Jane Doe\\upec\\watcher.js:3:1)',
    '    at x (/mnt/c/Users/janed/upec/x.js:1:1)',
  ].join('\n');
  const plain = formatFatal(err, {}, '/home/janedoe');
  assert.ok(!/Jane/.test(plain), plain);
  const out = formatFatal(err, { UPEC_WIPE_DEBUG: '1' }, '/home/janedoe');
  assert.ok(!/janedoe|Jane|janed/.test(out), out);
  assert.match(out, /~\/upec\/lib\/modes\/run\.js:10:5/);
});

test('the click debug line names the site but nothing after it', async () => {
  const el = { first: () => el, count: async () => 1, click: async () => { throw new Error('Timeout 2000ms exceeded'); } };
  const page = { locator: () => el, waitForTimeout: async () => {}, url: () => 'https://www.broker.example/opt-out?first=Jane' };
  const warned = [];
  const realWarn = console.warn;
  const had = process.env.UPEC_WIPE_DEBUG;
  console.warn = (...a) => warned.push(a.join(' '));
  process.env.UPEC_WIPE_DEBUG = '1';
  try {
    await _clickDoNotSell(page);
  } finally {
    console.warn = realWarn;
    if (had === undefined) delete process.env.UPEC_WIPE_DEBUG; else process.env.UPEC_WIPE_DEBUG = had;
  }
  assert.equal(warned.length, 1);
  assert.match(warned[0], /broker\.example/);
  assert.ok(!/Jane|opt-out/.test(warned[0]), warned[0]);
});
