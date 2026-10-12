'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'watcher.js'), 'utf8');

test('the email step runs only under --email', () => {
  assert.match(src, /const EMAIL\s+= process\.argv\.includes\('--email'\)/);
  assert.match(src, /const FORMS\s+= process\.argv\.includes\('--forms'\) \|\| !EMAIL/);
  const calls = src.match(/runEmailStep\(/g) || [];
  assert.equal(calls.length, 1);
  assert.match(src, /if \(EMAIL\) \{[\s\S]{0,1500}runEmailStep\(\{/);
});

test('the forms run no longer sends email', () => {
  assert.ok(!/sendOptOutEmails\(/.test(src), 'sendOptOutEmails must not be called from watcher.js');
});

test('--email alone returns before the browser opens', () => {
  assert.match(src, /if \(!FORMS\) return;/);
});
