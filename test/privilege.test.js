/**
 * test/privilege.test.js
 *
 * The fork never runs as root: config holds PII and the browser runs untrusted
 * pages, so a compromise should stay inside an unprivileged account.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rootRefusal, exitIfRoot } = require('../lib/privilege');

test('uid 0 is refused', () => { assert.match(rootRefusal(0), /root/); });
test('normal uid passes', () => { assert.equal(rootRefusal(1000), null); });
test('no getuid (Windows) passes', () => { assert.equal(rootRefusal(undefined), null); });

test('exitIfRoot exits 1 for root and is a no-op otherwise', () => {
  const codes = [];
  const errs = [];
  const fake = (uid) => ({ getuid: () => uid, exit: (c) => codes.push(c), stderr: { write: (s) => errs.push(s) } });
  exitIfRoot(fake(0));
  exitIfRoot(fake(501));
  exitIfRoot({ exit: (c) => codes.push(c), stderr: { write() {} } });
  assert.deepEqual(codes, [1]);
  assert.match(errs.join(''), /root/);
});
