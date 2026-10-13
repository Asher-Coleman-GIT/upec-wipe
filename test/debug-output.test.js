'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatFatal } = require('../lib/modes/shared');

test('a fatal error prints one line, plus the stack only with UPEC_WIPE_DEBUG', () => {
  const err = new Error('boom');
  assert.equal(formatFatal(err, {}), '\nFatal: boom');
  const dbg = formatFatal(err, { UPEC_WIPE_DEBUG: '1' });
  assert.ok(dbg.startsWith('\nFatal: boom\n'));
  assert.match(dbg, /at /);
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
